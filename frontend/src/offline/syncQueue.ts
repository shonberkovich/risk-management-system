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
// are processed in order, one at a time, stopping at the first failure so a still-offline
// device doesn't burn through retries out of order. And "draft-update"/"draft-submit" only
// ever apply to a draft that was already created online — a draft whose very *first* save
// happens while offline has no server-side id yet to update, so that case queues as "create"
// (with is_draft: true) instead; see IncidentReport.tsx's saveDraftMutation.
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
}

export interface SyncQueueState {
  pendingCount: number;
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
  const state: SyncQueueState = { pendingCount: items.length, syncing };
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

async function recordFailure(id: number, message: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const record = getRequest.result as QueuedIncidentReport | undefined;
      if (record) {
        record.lastError = message;
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

/** Flushes the queue in FIFO order; stops at the first failure to preserve ordering on retry. */
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
    for (const item of items) {
      // Defensive skip for a pre-v2 record (flat {payload, files}, no `operation`) left over
      // from before this queue supported draft-update/draft-submit/media — see DB_VERSION note.
      if (!item.operation) {
        await removeFromQueue(item.id);
        continue;
      }
      try {
        await runOperation(item.operation);
        await removeFromQueue(item.id);
        succeeded += 1;
      } catch (err) {
        failed += 1;
        await recordFailure(item.id, err instanceof Error ? err.message : "שגיאת סנכרון לא ידועה");
        break; // likely still offline/flaky — stop and retry the whole queue next trigger
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
