// Offline sync queue for the field incident-report form.
//
// When the network is unreachable, `enqueueIncidentReport` stores the full report
// (payload + attached photos, as Blobs) in an IndexedDB object store instead of failing
// outright. `registerAutoSync` (called once from main.tsx) flushes the queue automatically
// the moment the browser regains connectivity (the `online` event) or on next app load.
//
// Deliberately scoped down from a general-purpose offline framework: it only ever handles
// brand-new incident submissions (POST /incidents + media uploads), in queued order, one at
// a time, stopping at the first failure so a still-offline device doesn't burn through retries
// out of order. It does not attempt to queue draft PATCH/submit calls or any other endpoint.
import { createIncident, uploadIncidentMedia, type IncidentCreate } from "../api/client";

const DB_NAME = "rmis-offline";
const DB_VERSION = 1;
const STORE_NAME = "incident-queue";

interface QueuedFile {
  name: string;
  type: string;
  blob: Blob;
}

export interface QueuedIncidentReport {
  id: number;
  payload: IncidentCreate;
  files: QueuedFile[];
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

export async function enqueueIncidentReport(payload: IncidentCreate, files: File[]): Promise<number> {
  const db = await openDb();
  const queuedFiles: QueuedFile[] = files.map((f) => ({ name: f.name, type: f.type, blob: f }));
  const id = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const record: Omit<QueuedIncidentReport, "id"> = {
      payload,
      files: queuedFiles,
      queuedAt: new Date().toISOString(),
    };
    const request = tx.objectStore(STORE_NAME).add(record);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
  });
  await notify();
  return id;
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
      try {
        const incident = await createIncident(item.payload);
        for (const f of item.files) {
          const file = new File([f.blob], f.name, { type: f.type });
          // A media-upload failure shouldn't re-queue an already-created report — the
          // incident itself is safely on the server; only the photo attach step failed.
          await uploadIncidentMedia(incident.incident_id, file).catch(() => undefined);
        }
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
