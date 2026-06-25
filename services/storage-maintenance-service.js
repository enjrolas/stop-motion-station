// Keeps Origin Private File System usage healthy on small kiosk disks (e.g. a
// 4-8 GB Raspberry Pi SD card). Three responsibilities:
//
//   1. Ask the browser to make our storage *persistent* so the whole origin is
//      not silently evicted under disk pressure (OPFS is best-effort by default).
//   2. When usage approaches the quota, reclaim space by offloading the
//      full-resolution frame images of the oldest projects that are already
//      fully backed up to the gallery server. The small timeline thumbnails are
//      kept so projects still render; the originals are re-downloaded on demand
//      when such a project is reopened (sync-service.downloadProjectOriginals).
//   3. Track which projects are currently offloaded in `local-cache-state.json`
//      (kept separate from project metadata so it does not disturb ordering or
//      trigger re-syncs).
//
// The pure decision logic lives in helpers/ so it can be unit tested; this
// service performs the browser-only I/O (storage estimate, OPFS deletes).

import frameStorageService from "./frame-storage-service.js";
import projectStorageService from "./project-storage-service.js";
import syncService from "./sync-service.js";
import isProjectFullyBackedUp from "../helpers/project-backup-status.js";
import {
  isStorageOverHighWatermark,
  selectProjectsToEvict,
  ESTIMATED_ORIGINAL_FRAME_BYTES,
} from "../helpers/storage-eviction-policy.js";

const LOCAL_CACHE_STATE_FILE_NAME = "local-cache-state.json";

class StorageMaintenanceService {
  constructor() {
    this.hasRequestedPersistentStorage = false;
    this.cacheState = { version: 1, projects: {} };
    this.hasLoadedCacheState = false;
    this.persistStatePromise = Promise.resolve();
    this.isReclaiming = false;
  }

  // Asks the browser to mark this origin's storage as persistent. Returns the
  // resulting persistence boolean (true = durable, not subject to automatic
  // eviction). Safe to call repeatedly; the request is only made once.
  async requestPersistentStorageOnce() {
    if (this.hasRequestedPersistentStorage) {
      return this.readPersistedFlag();
    }

    this.hasRequestedPersistentStorage = true;

    if (typeof navigator === "undefined" || !navigator.storage) {
      return false;
    }

    try {
      if (typeof navigator.storage.persisted === "function") {
        const alreadyPersisted = await navigator.storage.persisted();
        if (alreadyPersisted) {
          return true;
        }
      }

      if (typeof navigator.storage.persist === "function") {
        const isPersisted = await navigator.storage.persist();
        console.info(
          isPersisted
            ? "Persistent storage granted; OPFS data is durable."
            : "Persistent storage was not granted; OPFS data remains evictable.",
        );
        return isPersisted;
      }
    } catch (persistRequestError) {
      console.warn("Could not request persistent storage:", persistRequestError);
    }

    return false;
  }

  async readPersistedFlag() {
    if (
      typeof navigator === "undefined"
      || !navigator.storage
      || typeof navigator.storage.persisted !== "function"
    ) {
      return false;
    }

    try {
      return await navigator.storage.persisted();
    } catch {
      return false;
    }
  }

  async getStorageEstimate() {
    if (
      typeof navigator === "undefined"
      || !navigator.storage
      || typeof navigator.storage.estimate !== "function"
    ) {
      return null;
    }

    try {
      const estimate = await navigator.storage.estimate();
      return {
        usageBytes: estimate.usage ?? 0,
        quotaBytes: estimate.quota ?? 0,
      };
    } catch (estimateError) {
      console.warn("Could not read storage estimate:", estimateError);
      return null;
    }
  }

  // Reclaims space when over the high-water mark by offloading the originals of
  // the oldest fully-backed-up projects. Never touches the open project (passed
  // as excludeProjectId) or projects already offloaded. Returns the ids evicted.
  async reclaimStorageIfNeeded({ excludeProjectId = null } = {}) {
    if (this.isReclaiming) {
      return [];
    }

    // Offloading is only safe when we can re-download from the backend later.
    if (!syncService.isEnabled()) {
      return [];
    }

    const estimate = await this.getStorageEstimate();

    if (
      !estimate
      || !isStorageOverHighWatermark({
        usageBytes: estimate.usageBytes,
        quotaBytes: estimate.quotaBytes,
      })
    ) {
      return [];
    }

    this.isReclaiming = true;

    try {
      await this.loadCacheState();

      const projectMetadataList = await projectStorageService.listProjects();
      const candidates = [];

      for (const projectMetadata of projectMetadataList) {
        const projectId = projectMetadata.id;

        if (projectId === excludeProjectId || this.isProjectOffloaded(projectId)) {
          continue;
        }

        let projectFrames;
        try {
          projectFrames = (await projectStorageService.loadProject({ projectId })).frames;
        } catch {
          continue;
        }

        const snapshot = await syncService.getProjectSyncSnapshot(projectId);
        const isEvictable = Boolean(snapshot?.remoteId)
          && isProjectFullyBackedUp({
            frames: projectFrames,
            uploadedByNumber: snapshot.uploadedByNumber,
          });

        const originalFrameCount = projectFrames.filter(
          (frameRecord) => frameRecord?.originalStorageKey,
        ).length;

        candidates.push({
          projectId,
          updatedAtMilliseconds: projectMetadata.updatedAtMilliseconds ?? 0,
          reclaimableBytes: originalFrameCount * ESTIMATED_ORIGINAL_FRAME_BYTES,
          isEvictable,
          frames: projectFrames,
        });
      }

      const projectIdsToEvict = selectProjectsToEvict({
        usageBytes: estimate.usageBytes,
        quotaBytes: estimate.quotaBytes,
        candidates,
      });

      for (const projectId of projectIdsToEvict) {
        const candidate = candidates.find((entry) => entry.projectId === projectId);
        await this.evictProjectOriginals({ projectId, frames: candidate.frames });
      }

      return projectIdsToEvict;
    } finally {
      this.isReclaiming = false;
    }
  }

  // Deletes a project's full-resolution originals (keeping the small timeline
  // thumbnails so the project still renders) and records it as offloaded.
  async evictProjectOriginals({ projectId, frames }) {
    let removedCount = 0;

    for (const frameRecord of frames ?? []) {
      if (!frameRecord?.originalStorageKey) {
        continue;
      }

      try {
        await frameStorageService.deleteOriginalFrame({
          storageKey: frameRecord.originalStorageKey,
        });
        removedCount += 1;
      } catch (evictError) {
        console.warn("Could not evict frame original:", frameRecord.originalStorageKey, evictError);
      }
    }

    await this.markProjectOffloaded(projectId);
    console.info(
      `Offloaded ${removedCount} full-res frames for project ${projectId} (backed up to server).`,
    );
    return removedCount;
  }

  isProjectOffloaded(projectId) {
    return Boolean(this.cacheState.projects[projectId]?.originalsOffloaded);
  }

  async markProjectOffloaded(projectId) {
    await this.loadCacheState();
    this.cacheState.projects[projectId] = {
      originalsOffloaded: true,
      offloadedAtMilliseconds: Date.now(),
    };
    await this.saveCacheState();
  }

  async clearProjectOffload(projectId) {
    await this.loadCacheState();

    if (this.cacheState.projects[projectId]) {
      delete this.cacheState.projects[projectId];
      await this.saveCacheState();
    }
  }

  async loadCacheState() {
    if (this.hasLoadedCacheState) {
      return;
    }

    try {
      const rootDirectoryHandle = await navigator.storage.getDirectory();
      const stateFileHandle = await rootDirectoryHandle.getFileHandle(LOCAL_CACHE_STATE_FILE_NAME);
      const stateFile = await stateFileHandle.getFile();
      const stateText = await stateFile.text();

      if (stateText.trim()) {
        const parsedState = JSON.parse(stateText);

        if (parsedState && typeof parsedState.projects === "object") {
          this.cacheState = { version: 1, projects: parsedState.projects ?? {} };
        }
      }
    } catch (loadError) {
      if (loadError?.name !== "NotFoundError") {
        console.warn("Could not load local cache state:", loadError);
      }
    }

    this.hasLoadedCacheState = true;
  }

  saveCacheState() {
    // Serialize writes so concurrent updates cannot corrupt the state file.
    this.persistStatePromise = this.persistStatePromise
      .catch(() => {})
      .then(() => this.writeCacheStateToStorage());
    return this.persistStatePromise;
  }

  async writeCacheStateToStorage() {
    const rootDirectoryHandle = await navigator.storage.getDirectory();
    const stateFileHandle = await rootDirectoryHandle.getFileHandle(LOCAL_CACHE_STATE_FILE_NAME, {
      create: true,
    });

    const writableStream = await stateFileHandle.createWritable();

    try {
      await writableStream.write(JSON.stringify(this.cacheState));
    } finally {
      await writableStream.close();
    }
  }
}

const storageMaintenanceService = new StorageMaintenanceService();

// Convenience named export so startup can request persistence without reaching
// through the singleton.
export function requestPersistentStorageOnce() {
  return storageMaintenanceService.requestPersistentStorageOnce();
}

export default storageMaintenanceService;
