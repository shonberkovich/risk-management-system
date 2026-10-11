// Offline sync queue for the field incident-report form.
//
// When the network is unreachable, this module stores a *pending operation* (payload +
// attached photos, as Blobs) in an IndexedDB object store instead of failing outright.
// `registerAutoSync` (called once from main.tsx) flushes the queue automatically the moment
// the browser regains connectivity (the `online` event) or on next app load.
//
// Four operation kinds cover the full incident-report lifecycle offline:
//   - "create"        brand-new incident submission (final, or a first-time draft save —
//                      both need the full IncidentCreate shape since no server-side id
//                      exists yet to PATCH against).
//   - "draft-update"   saving further edits to a draft that already has a server-side id
//                      (created while online, then edited with no connectivity).
//   - "draft-submit"   finalizing (PATCH + submit) a draft that already has a server-side
//                      id — the case a naive "just queue a create" approach would get wrong,
//                      producing a duplicate incident instead of finalizing the existing one.
//   - "media"          attaching photos to an incident that already exists on the server
//                      (e.g. the report itself sent successfully but the network dropped
//                      mid-upload for its photos).
//
// Deliberately still scoped down from a general-purpose offline framework: queued operations
// are processed in order, one at a time. A failure that may well succeed later (no network,
// a 5xx, an expired session) stops the run, so a still-offline device doesn't burn through
// retries out of order. A failure that never will — the server answered with a 4xx such as
// "this draft was already submitted" or a validation error — marks just that item as failed
// (with the server's reason) and the run moves on: one bad item must not hold back every
// report queued after it. Failed items wait for the user to retry or discard them; later
// items for the same draft/incident wait too, so a draft's own operations stay in order.
// And "draft-update"/"draft-submit" only
// ever apply to a draft that was already created online — a draft whose very *first* save
// happens while offline has no server-side id yet to update, so that case queues as "create"
// (with is_draft: true) instead; see IncidentReport.tsx's saveDraftMutation.
import { isAxiosError } from "axios";

import {
  createIncident,
  submitDraftIncident,
  updateDraftIncident,
  uploadIncidentMedia,
  type Incident,
  type IncidentCreate,
  type IncidentUpdate,
} from "../api/client";

const DB_NAME = "rmis-offline";
// v2: queued items moved from a flat {payload, files} shape (create-only) to a discriminated
// `operation` union covering draft-update/draft-submit/media too. onupgradeneeded below just
// re-declares the same object store — IndexedDB has no per-record schema, so no migration of
// existing v1 records is needed/possible; any v1 leftovers are skipped defensively in trySync.
const DB_VERSION = 2;
const STORE_NAME = "incident-queue";

interface QueuedFile {
  name: string;
  type: string;
  blob: Blob;
}

type QueuedOperation =
  | { kind: "create"; payload: IncidentCreate; files: QueuedFile[] }
  | { kind: "draft-update"; draftId: number; payload: IncidentUpdate; files: QueuedFile[] }
  | { kind: "draft-submit"; draftId: number; payload: IncidentUpdate; files: QueuedFile[] }
  | { kind: "media"; incidentId: number; files: QueuedFile[] };

export interface QueuedIncidentReport {
  id: number;
  operation: QueuedOperation;
  queuedAt: string;
  lastError?: string;
  /** Set when the server rejected the item outright (a 4xx that a retry won't change):
   * automatic syncs skip it until the user retries or discards it. */
  failed?: boolean;
}

export interface SyncQueueState {
  /** Items still waiting for an automatic sync. */
  pendingCount: number;
  /** Items the server rejected — they need the user (retry or discard). */
  failedCount: number;
  syncing: boolean;
}

type Listener = (state: SyncQueueState) => void;

const listeners = new Set<Listener>();
let syncing = false;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB אינו נתמך בדפדפן זה"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export function isOfflineStorageAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

async function notify() {
  const items = await getQueuedReports().catch(() => [] as QueuedIncidentReport[]);
  const failedCount = items.filter((item) => item.failed).length;
  const state: SyncQueueState = { pendingCount: items.length - failedCount, failedCount, syncing };
  listeners.forEach((listener) => listener(state));
}

/** Subscribe to queue-length/syncing changes; fires immediately with the current state. */
export function subscribeToSyncQueue(listener: Listener): () => void {
  listeners.add(listener);
  notify();
  return () => {
    listeners.delete(listener);
  };
}

function toQueuedFiles(files: File[]): QueuedFile[] {
  return files.map((f) => ({ name: f.name, type: f.type, blob: f }));
}

async function enqueue(operation: QueuedOperation): Promise<number> {
  const db = await openDb();
  const id = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const record: Omit<QueuedIncidentReport, "id"> = { operation, queuedAt: new Date().toISOString() };
    const request = tx.objectStore(STORE_NAME).add(record);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
  });
  await notify();
  return id;
}

/** Queue a brand-new incident submission (final, or a draft's first save — draftId doesn't
 * exist server-side yet either way, so both need the full IncidentCreate shape). */
export function enqueueIncidentReport(payload: IncidentCreate, files: File[]): Promise<number> {
  return enqueue({ kind: "create", payload, files: toQueuedFiles(files) });
}

/** Queue an edit to a draft that already has a server-side id. */
export function enqueueDraftUpdate(draftId: number, payload: IncidentUpdate, files: File[]): Promise<number> {
  return enqueue({ kind: "draft-update", draftId, payload, files: toQueuedFiles(files) });
}

/** Queue finalizing (PATCH + submit) a draft that already has a server-side id — keeps the
 * existing incident's identity instead of creating a duplicate once back online. */
export function enqueueDraftSubmit(draftId: number, payload: IncidentUpdate, files: File[]): Promise<number> {
  return enqueue({ kind: "draft-submit", draftId, payload, files: toQueuedFiles(files) });
}

/** Queue photos for an incident that already exists on the server. */
export function enqueueMediaUpload(incidentId: number, files: File[]): Promise<number> {
  return enqueue({ kind: "media", incidentId, files: toQueuedFiles(files) });
}

export async function getQueuedReports(): Promise<QueuedIncidentReport[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as QueuedIncidentReport[]);
    request.onerror = () => reject(request.error);
  });
}

async function removeFromQueue(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateRecord(id: number, change: (record: QueuedIncidentReport) => void): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const record = getRequest.result as QueuedIncidentReport | undefined;
      if (record) {
        change(record);
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function recordFailure(id: number, message: string, permanent: boolean): Promise<void> {
  return updateRecord(id, (record) => {
    record.lastError = message;
    record.failed = permanent || undefined;
  });
}

/** A rejection that retrying the same request won't change: a 4xx from the server, other
 * than an expired session (401), a request timeout (408) or rate limiting (429). */
function isPermanentFailure(err: unknown): boolean {
  if (!isAxiosError(err) || !err.response) return false;
  const status = err.response.status;
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

/** The server's own reason when it gave one (FastAPI's `detail`, a string or a list of
 * validation errors), else the error's message. */
function failureMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : ""))
        .filter(Boolean);
      if (messages.length) return messages.join("; ");
    }
  }
  return err instanceof Error ? err.message : "שגיאת סנכרון לא ידועה";
}

/** The server-side draft/incident an operation acts on, if it already exists. */
function targetIncidentId(operation: QueuedOperation): number | null {
  switch (operation.kind) {
    case "draft-update":
    case "draft-submit":
      return operation.draftId;
    case "media":
      return operation.incidentId;
    default:
      return null;
  }
}

/** Items the server rejected, oldest first — for showing them with their reason. */
export async function getFailedReports(): Promise<QueuedIncidentReport[]> {
  return (await getQueuedReports()).filter((item) => item.failed);
}

/** Drops a queued item for good (the user gave up on it). */
export async function discardQueuedReport(id: number): Promise<void> {
  await removeFromQueue(id);
  await notify();
}

/** Puts a failed item back in line and tries to sync right away. */
export async function retryQueuedReport(id: number): Promise<SyncResult> {
  await updateRecord(id, (record) => {
    delete record.failed;
    delete record.lastError;
  });
  await notify();
  return trySync();
}

async function uploadQueuedFiles(incidentId: number, files: QueuedFile[]): Promise<void> {
  for (const f of files) {
    const file = new File([f.blob], f.name, { type: f.type });
    // A media-upload failure shouldn't fail the whole sync item — whatever the operation
    // created/updated on the server is still good; only the photo attach step failed.
    await uploadIncidentMedia(incidentId, file).catch(() => undefined);
  }
}

async function runOperation(operation: QueuedOperation): Promise<void> {
  switch (operation.kind) {
    case "create": {
      const incident: Incident = await createIncident(operation.payload);
      await uploadQueuedFiles(incident.incident_id, operation.files);
      return;
    }
    case "draft-update": {
      await updateDraftIncident(operation.draftId, operation.payload);
      await uploadQueuedFiles(operation.draftId, operation.files);
      return;
    }
    case "draft-submit": {
      await updateDraftIncident(operation.draftId, operation.payload);
      const incident = await submitDraftIncident(operation.draftId);
      await uploadQueuedFiles(incident.incident_id, operation.files);
      return;
    }
    case "media": {
      await uploadQueuedFiles(operation.incidentId, operation.files);
      return;
    }
  }
}

export interface SyncResult {
  succeeded: number;
  failed: number;
}

/** Flushes the queue in FIFO order. Stops at the first failure that may be temporary (to
 * preserve ordering on retry); a permanent rejection only sets that item aside. */
export async function trySync(): Promise<SyncResult> {
  if (syncing || !navigator.onLine || !isOfflineStorageAvailable()) {
    return { succeeded: 0, failed: 0 };
  }
  syncing = true;
  await notify();
  let succeeded = 0;
  let failed = 0;
  try {
    const items = await getQueuedReports();
    // Drafts/incidents with an earlier operation still unresolved (failed, now or before):
    // their later operations wait, so one draft's edits never apply out of order.
    const heldTargets = new Set<number>();
    for (const item of items) {
      // Defensive skip for a pre-v2 record (flat {payload, files}, no `operation`) left over
      // from before this queue supported draft-update/draft-submit/media — see DB_VERSION note.
      if (!item.operation) {
        await removeFromQueue(item.id);
        continue;
      }
      const target = targetIncidentId(item.operation);
      if (item.failed || (target !== null && heldTargets.has(target))) {
        if (target !== null) heldTargets.add(target);
        continue;
      }
      try {
        await runOperation(item.operation);
        await removeFromQueue(item.id);
        succeeded += 1;
      } catch (err) {
        failed += 1;
        const permanent = isPermanentFailure(err);
        await recordFailure(item.id, failureMessage(err), permanent);
        if (!permanent) break; // likely still offline/flaky — stop and retry the whole queue next trigger
        if (target !== null) heldTargets.add(target);
      }
    }
  } finally {
    syncing = false;
    await notify();
  }
  return { succeeded, failed };
}

let autoSyncRegistered = false;

/** Call once at app startup: syncs on load (if online) and again whenever the browser reconnects. */
export function registerAutoSync(): void {
  if (autoSyncRegistered || !isOfflineStorageAvailable()) return;
  autoSyncRegistered = true;
  window.addEventListener("online", () => {
    trySync();
  });
  if (navigator.onLine) {
    trySync();
  }
}
