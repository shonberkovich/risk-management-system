import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IncidentCreate } from "../api/client";

// Mocked at the module boundary syncQueue.ts actually imports — createIncident et al. — so
// these tests exercise the *queueing/sync-ordering logic* in isolation from the real HTTP layer.
const createIncident = vi.fn();
const submitDraftIncident = vi.fn();
const updateDraftIncident = vi.fn();
const uploadIncidentMedia = vi.fn();
vi.mock("../api/client", () => ({
  createIncident: (...args: unknown[]) => createIncident(...args),
  submitDraftIncident: (...args: unknown[]) => submitDraftIncident(...args),
  updateDraftIncident: (...args: unknown[]) => updateDraftIncident(...args),
  uploadIncidentMedia: (...args: unknown[]) => uploadIncidentMedia(...args),
}));

// Imported once (not per-test) deliberately: the module keeps a single cached IndexedDB
// connection (`dbPromise`) internally, and re-importing it mid-suite (e.g. via
// vi.resetModules()) would leave that old connection open, which then blocks any attempt to
// delete/reopen the same database — IndexedDB queues a new open() behind a still-pending
// delete of the same name. Isolating each test by clearing the object store directly (below)
// avoids that entirely.
import {
  enqueueDraftSubmit,
  enqueueIncidentReport,
  getQueuedReports,
  isOfflineStorageAvailable,
  subscribeToSyncQueue,
  trySync,
} from "./syncQueue";

const DB_NAME = "rmis-offline";
const STORE_NAME = "incident-queue";

function clearQueueStore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME, 2);
    openReq.onupgradeneeded = () => {
      openReq.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

const BASE_PAYLOAD: IncidentCreate = {
  property_id: 1,
  incident_timestamp: "2026-08-21T10:00:00.000Z",
  hazard_type: "FLOOD",
  severity_level: "MEDIUM",
  operational_impact: "PARTIAL_SHUTDOWN",
  initial_estimated_loss: 10_000,
  description: "הצפה קלה במחסן",
  is_draft: false,
  business_interruption_requested: false,
  reported_coordinates: null,
};

describe("syncQueue", () => {
  let onLineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    createIncident.mockReset();
    submitDraftIncident.mockReset();
    updateDraftIncident.mockReset();
    uploadIncidentMedia.mockReset();
    onLineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await clearQueueStore();
  });

  afterEach(() => {
    onLineSpy.mockRestore();
  });

  it("queues a new incident report and reports it via getQueuedReports/pending count", async () => {
    const states: number[] = [];
    const unsubscribe = subscribeToSyncQueue((s) => states.push(s.pendingCount));

    await enqueueIncidentReport(BASE_PAYLOAD, []);

    const queued = await getQueuedReports();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toEqual({ kind: "create", payload: BASE_PAYLOAD, files: [] });
    expect(states[states.length - 1]).toBe(1);
    unsubscribe();
  });

  it("does nothing when offline — trySync is a no-op and nothing is removed from the queue", async () => {
    onLineSpy.mockReturnValue(false);
    await enqueueIncidentReport(BASE_PAYLOAD, []);
    const result = await trySync();

    expect(result).toEqual({ succeeded: 0, failed: 0 });
    expect(createIncident).not.toHaveBeenCalled();
    expect(await getQueuedReports()).toHaveLength(1);
  });

  it("syncs a queued 'create' operation and removes it from the queue on success", async () => {
    createIncident.mockResolvedValue({ incident_id: 42, incident_code: "INC-0042" });
    await enqueueIncidentReport(BASE_PAYLOAD, []);
    const result = await trySync();

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(createIncident).toHaveBeenCalledWith(BASE_PAYLOAD);
    expect(await getQueuedReports()).toHaveLength(0);
  });

  it("finalizes a 'draft-submit' operation via update-then-submit, preserving the existing draft's identity", async () => {
    updateDraftIncident.mockResolvedValue(undefined);
    submitDraftIncident.mockResolvedValue({ incident_id: 7, incident_code: "INC-0007" });

    await enqueueDraftSubmit(7, { description: "עדכון סופי" }, []);
    const result = await trySync();

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(updateDraftIncident).toHaveBeenCalledWith(7, { description: "עדכון סופי" });
    expect(submitDraftIncident).toHaveBeenCalledWith(7);
    // No brand-new incident should ever be created for a draft-submit — that's exactly the
    // duplicate-incident bug this operation kind exists to avoid (see syncQueue.ts docstring).
    expect(createIncident).not.toHaveBeenCalled();
  });

  it("uploads queued media against the resulting incident id after a 'create' syncs", async () => {
    createIncident.mockResolvedValue({ incident_id: 99, incident_code: "INC-0099" });
    uploadIncidentMedia.mockResolvedValue({});

    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await enqueueIncidentReport(BASE_PAYLOAD, [file]);
    await trySync();

    expect(uploadIncidentMedia).toHaveBeenCalledTimes(1);
    const [incidentId, uploadedFile] = uploadIncidentMedia.mock.calls[0];
    expect(incidentId).toBe(99);
    expect(uploadedFile.name).toBe("photo.jpg");
  });

  it("stops at the first failure and keeps FIFO order intact for the next sync attempt", async () => {
    createIncident
      .mockRejectedValueOnce(new Error("network drop"))
      .mockResolvedValueOnce({ incident_id: 2, incident_code: "INC-0002" });

    await enqueueIncidentReport({ ...BASE_PAYLOAD, description: "אירוע ראשון" }, []);
    await enqueueIncidentReport({ ...BASE_PAYLOAD, description: "אירוע שני" }, []);

    const firstAttempt = await trySync();
    expect(firstAttempt).toEqual({ succeeded: 0, failed: 1 });
    // Second item must not have been attempted — ordering is preserved, not raced.
    expect(createIncident).toHaveBeenCalledTimes(1);
    let remaining = await getQueuedReports();
    expect(remaining).toHaveLength(2);
    expect(remaining[0].lastError).toBe("network drop");

    // Retrying (e.g. connectivity restored) picks the first item back up in order.
    const secondAttempt = await trySync();
    expect(secondAttempt).toEqual({ succeeded: 1, failed: 1 });
    remaining = await getQueuedReports();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].operation).toMatchObject({ payload: { description: "אירוע שני" } });
  });

  it("a media-upload failure does not fail the whole sync item", async () => {
    createIncident.mockResolvedValue({ incident_id: 5, incident_code: "INC-0005" });
    uploadIncidentMedia.mockRejectedValue(new Error("upload failed"));

    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await enqueueIncidentReport(BASE_PAYLOAD, [file]);
    const result = await trySync();

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(await getQueuedReports()).toHaveLength(0);
  });

  it("isOfflineStorageAvailable reflects indexedDB presence on window", () => {
    expect(isOfflineStorageAvailable()).toBe(true);
  });
});
