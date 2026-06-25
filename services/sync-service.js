import frameStorageService from "./frame-storage-service.js";
import projectStorageService from "./project-storage-service.js";

const SYNC_STATE_FILE_NAME = "sync-state.json";
const DEVICE_USER_ID_STORAGE_KEY = "smbs.device-user-id";
const RETRY_DELAY_MILLISECONDS = 15000;
const PERIODIC_SYNC_CHECK_INTERVAL_MILLISECONDS = 60000;

// Pushes locally captured projects and frames to the backend gallery server.
// One-way (upload only): local Origin Private File System storage stays the
// source of truth. The backend identifies frames only by an integer position,
// so we mirror the local timeline order onto the remote frame numbers.
class SyncService {
  constructor() {
    this.config = null;
    this.deviceUserId = null;
    this.syncState = { version: 1, projects: {} };
    this.hasLoadedSyncState = false;
    this.initializePromise = null;

    this.pendingProjectIds = new Set();
    this.isProcessingQueue = false;
    this.retryTimeoutIdentifier = null;
    this.periodicMonitorIdentifier = null;
    this.persistStatePromise = Promise.resolve();

    this.status = {
      enabled: false,
      state: "disabled",
      message: "Backend sync is not configured.",
      pendingProjectCount: 0,
      lastSyncedAtMilliseconds: null,
      lastErrorMessage: null,
    };
    this.statusListener = null;
  }

  setStatusListener(statusListener) {
    this.statusListener = statusListener;
  }

  getStatus() {
    return { ...this.status };
  }

  updateStatus(partialStatus) {
    this.status = {
      ...this.status,
      ...partialStatus,
      pendingProjectCount: this.pendingProjectIds.size,
    };

    if (this.statusListener) {
      this.statusListener(this.getStatus());
    }
  }

  async initialize() {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.initializeInternal();
    return this.initializePromise;
  }

  async initializeInternal() {
    this.config = await loadSyncConfig();

    if (!this.config?.apiKey) {
      this.updateStatus({
        enabled: false,
        state: "disabled",
        message: "Backend sync is not configured.",
      });
      return false;
    }

    this.deviceUserId = resolveDeviceUserId();
    await this.loadSyncState();

    this.updateStatus({
      enabled: true,
      state: "idle",
      message: "Backend sync ready.",
    });

    this.startPeriodicSyncMonitor();

    return true;
  }

  startPeriodicSyncMonitor() {
    if (this.periodicMonitorIdentifier !== null) {
      return;
    }

    // Heartbeat backstop: once a minute, if everything is not confirmed synced,
    // re-enqueue every project and try again. Covers transient outages and any
    // retry that may have been missed.
    this.periodicMonitorIdentifier = setInterval(() => {
      this.runPeriodicSyncCheck();
    }, PERIODIC_SYNC_CHECK_INTERVAL_MILLISECONDS);
  }

  runPeriodicSyncCheck() {
    if (!this.isEnabled()) {
      return;
    }

    // Already up to date, or a sync pass is actively running — nothing to do.
    if (this.status.state === "synced" || this.status.state === "syncing") {
      return;
    }

    this.requestFullSync().catch((periodicSyncError) => {
      console.warn("Periodic backend sync check failed to start:", periodicSyncError);
    });
  }

  isEnabled() {
    return Boolean(this.config?.apiKey);
  }

  requestProjectSync(projectId) {
    if (!projectId) {
      return;
    }

    this.pendingProjectIds.add(projectId);
    this.updateStatus({});
    this.startQueueProcessingIfEnabled();
  }

  async requestFullSync() {
    const isReady = await this.initialize();

    if (!isReady) {
      return;
    }

    const projectMetadataList = await projectStorageService.listProjects();

    for (const projectMetadata of projectMetadataList) {
      this.pendingProjectIds.add(projectMetadata.id);
    }

    this.updateStatus({});
    this.startQueueProcessingIfEnabled();
  }

  async startQueueProcessingIfEnabled() {
    const isReady = await this.initialize();

    if (!isReady || this.isProcessingQueue || this.pendingProjectIds.size === 0) {
      // Nothing queued and no pass running means everything is up to date.
      if (
        isReady
        && !this.isProcessingQueue
        && this.pendingProjectIds.size === 0
        && this.status.state !== "synced"
      ) {
        this.updateStatus({
          state: "synced",
          message: "All changes synced.",
          lastSyncedAtMilliseconds: Date.now(),
          lastErrorMessage: null,
        });
      }
      return;
    }

    this.isProcessingQueue = true;
    this.updateStatus({ state: "syncing", message: "Syncing to backend…" });

    let encounteredError = false;
    const deferredProjectIds = [];

    while (this.pendingProjectIds.size > 0) {
      const projectId = this.pendingProjectIds.values().next().value;
      this.pendingProjectIds.delete(projectId);
      this.updateStatus({});

      try {
        const { isComplete } = await this.syncSingleProject(projectId);

        if (!isComplete) {
          // Some frames are still being written to local storage. Try again
          // shortly without treating it as an error.
          deferredProjectIds.push(projectId);
        }
      } catch (syncError) {
        encounteredError = true;
        console.warn("Backend sync failed for project", projectId, syncError);
        // Re-queue for a later retry attempt.
        this.pendingProjectIds.add(projectId);
        this.updateStatus({
          state: "error",
          message: "Sync paused — will retry.",
          lastErrorMessage: syncError?.message ?? String(syncError),
        });
        break;
      }
    }

    this.isProcessingQueue = false;

    for (const deferredProjectId of deferredProjectIds) {
      this.pendingProjectIds.add(deferredProjectId);
    }

    if (encounteredError) {
      this.scheduleRetry();
      return;
    }

    if (deferredProjectIds.length > 0) {
      this.scheduleRetry();
      this.updateStatus({ state: "syncing", message: "Waiting for frames to finish saving…" });
      return;
    }

    if (this.pendingProjectIds.size > 0) {
      this.startQueueProcessingIfEnabled();
      return;
    }

    this.updateStatus({
      state: "synced",
      message: "All changes synced.",
      lastSyncedAtMilliseconds: Date.now(),
      lastErrorMessage: null,
    });
  }

  scheduleRetry() {
    if (this.retryTimeoutIdentifier !== null) {
      return;
    }

    this.retryTimeoutIdentifier = setTimeout(() => {
      this.retryTimeoutIdentifier = null;
      this.startQueueProcessingIfEnabled();
    }, RETRY_DELAY_MILLISECONDS);
  }

  async syncSingleProject(projectId) {
    let loadedProject;

    try {
      loadedProject = await projectStorageService.loadProject({ projectId });
    } catch (loadError) {
      // The project no longer exists locally. There is no backend project-delete
      // endpoint, so we simply forget our local sync bookkeeping for it.
      if (this.syncState.projects[projectId]) {
        delete this.syncState.projects[projectId];
        await this.saveSyncState();
      }
      return { isComplete: true };
    }

    const projectSyncEntry = await this.ensureRemoteProject({
      projectId,
      title: loadedProject.title,
    });

    const framesResult = await this.syncProjectFrames({
      projectSyncEntry,
      frames: loadedProject.frames,
    });

    await this.saveSyncState();
    return framesResult;
  }

  async ensureRemoteProject({ projectId, title }) {
    let projectSyncEntry = this.syncState.projects[projectId] ?? null;

    if (projectSyncEntry?.remoteId) {
      if (projectSyncEntry.title !== title) {
        try {
          await this.apiRequestJson(`/projects/${projectSyncEntry.remoteId}/`, {
            method: "PATCH",
            jsonBody: { title },
          });
          projectSyncEntry.title = title;
        } catch (patchError) {
          if (patchError.statusCode === 404) {
            projectSyncEntry = null;
          } else {
            throw patchError;
          }
        }
      }

      if (projectSyncEntry) {
        return projectSyncEntry;
      }
    }

    const createdProject = await this.apiRequestJson("/projects/", {
      method: "POST",
      jsonBody: {
        user_id: this.deviceUserId,
        title,
        is_public: false,
      },
    });

    projectSyncEntry = {
      remoteId: createdProject.id,
      title,
      uploadedByNumber: {},
    };
    this.syncState.projects[projectId] = projectSyncEntry;
    return projectSyncEntry;
  }

  async syncProjectFrames({ projectSyncEntry, frames }) {
    const uploadedByNumber = projectSyncEntry.uploadedByNumber ?? {};
    projectSyncEntry.uploadedByNumber = uploadedByNumber;

    let deferredFrameForLaterRetry = false;

    // Upload frames whose image at a given position changed (covers captures,
    // reorders and replacements). Positions are 1-based to match the backend.
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const frameRecord = frames[frameIndex];
      const frameNumber = frameIndex + 1;
      const frameNumberKey = String(frameNumber);

      if (!frameRecord?.originalStorageKey) {
        // Image not persisted yet; leave this position for a later pass so we
        // never upload a different frame's image to this number.
        deferredFrameForLaterRetry = true;
        continue;
      }

      if (uploadedByNumber[frameNumberKey] === frameRecord.id) {
        continue;
      }

      let frameImageFile;
      try {
        frameImageFile = await frameStorageService.readOriginalFrameFile({
          storageKey: frameRecord.originalStorageKey,
        });
      } catch (frameReadError) {
        if (frameReadError?.name === "NotFoundError") {
          // The background worker has not finished writing this frame yet.
          deferredFrameForLaterRetry = true;
          continue;
        }
        throw frameReadError;
      }

      await this.uploadFrameImage({
        remoteProjectId: projectSyncEntry.remoteId,
        frameNumber,
        frameImageFile,
        fileName: frameRecord.originalStorageKey,
      });

      uploadedByNumber[frameNumberKey] = frameRecord.id;
    }

    // Delete any remote frames beyond the current local length.
    for (const uploadedNumberKey of Object.keys(uploadedByNumber)) {
      const uploadedNumber = Number.parseInt(uploadedNumberKey, 10);

      if (uploadedNumber > frames.length) {
        await this.deleteFrame({
          remoteProjectId: projectSyncEntry.remoteId,
          frameNumber: uploadedNumber,
        });
        delete uploadedByNumber[uploadedNumberKey];
      }
    }

    // Report whether every local frame made it to the backend. A deferred
    // frame (image not written to local storage yet) re-queues the project.
    return { isComplete: !deferredFrameForLaterRetry };
  }

  async uploadFrameImage({ remoteProjectId, frameNumber, frameImageFile, fileName }) {
    const formData = new FormData();
    formData.append("number", String(frameNumber));
    formData.append("image", frameImageFile, fileName ?? `frame-${frameNumber}.jpg`);

    await this.apiRequest(`/projects/${remoteProjectId}/frames/`, {
      method: "POST",
      body: formData,
    });
  }

  async deleteFrame({ remoteProjectId, frameNumber }) {
    try {
      await this.apiRequest(`/projects/${remoteProjectId}/frames/${frameNumber}/`, {
        method: "DELETE",
      });
    } catch (deleteError) {
      if (deleteError.statusCode !== 404) {
        throw deleteError;
      }
    }
  }

  async uploadProjectVideo({ projectId, videoBlob, durationSeconds }) {
    const isReady = await this.initialize();

    if (!isReady) {
      return false;
    }

    let loadedProject;
    try {
      loadedProject = await projectStorageService.loadProject({ projectId });
    } catch {
      return false;
    }

    const projectSyncEntry = await this.ensureRemoteProject({
      projectId,
      title: loadedProject.title,
    });
    await this.saveSyncState();

    const formData = new FormData();
    formData.append("file", videoBlob, `${projectId}.mp4`);

    if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
      formData.append("duration_seconds", String(durationSeconds));
    }

    await this.apiRequest(`/projects/${projectSyncEntry.remoteId}/video/`, {
      method: "POST",
      body: formData,
    });

    return true;
  }

  async markProjectVideoChanged(projectId) {
    const isReady = await this.initialize();

    if (!isReady) {
      return;
    }

    const projectSyncEntry = this.syncState.projects[projectId];

    if (!projectSyncEntry?.remoteId) {
      // No remote project (and therefore no remote video) exists yet.
      return;
    }

    try {
      await this.apiRequest(`/projects/${projectSyncEntry.remoteId}/video/mark-changed/`, {
        method: "POST",
      });
    } catch (markChangedError) {
      // 404 simply means no video has been uploaded for this project yet.
      if (markChangedError.statusCode !== 404) {
        throw markChangedError;
      }
    }
  }

  async apiRequest(path, { method = "GET", body, headers, jsonBody } = {}) {
    const requestHeaders = {
      Authorization: `Api-Key ${this.config.apiKey}`,
      ...(headers ?? {}),
    };

    let requestBody = body;

    if (jsonBody !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
      requestBody = JSON.stringify(jsonBody);
    }

    let response;
    try {
      response = await fetch(`${this.config.apiBaseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: requestBody,
      });
    } catch (networkError) {
      throw new SyncError(`Network error contacting backend: ${networkError.message}`, null);
    }

    if (!response.ok) {
      const errorText = await safeReadResponseText(response);
      throw new SyncError(
        `Backend responded ${response.status} for ${method} ${path}: ${errorText}`,
        response.status,
      );
    }

    return response;
  }

  async apiRequestJson(path, options) {
    const response = await this.apiRequest(path, options);

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async loadSyncState() {
    if (this.hasLoadedSyncState) {
      return;
    }

    try {
      const rootDirectoryHandle = await navigator.storage.getDirectory();
      const syncStateFileHandle = await rootDirectoryHandle.getFileHandle(SYNC_STATE_FILE_NAME);
      const syncStateFile = await syncStateFileHandle.getFile();
      const syncStateText = await syncStateFile.text();

      if (syncStateText.trim()) {
        const parsedSyncState = JSON.parse(syncStateText);

        if (parsedSyncState && typeof parsedSyncState.projects === "object") {
          this.syncState = {
            version: 1,
            projects: parsedSyncState.projects ?? {},
          };
        }
      }
    } catch (loadError) {
      if (loadError?.name !== "NotFoundError") {
        console.warn("Could not load backend sync state:", loadError);
      }
    }

    this.hasLoadedSyncState = true;
  }

  saveSyncState() {
    // Serialize writes so concurrent syncs cannot corrupt the state file.
    this.persistStatePromise = this.persistStatePromise
      .catch(() => {})
      .then(() => this.writeSyncStateToStorage());
    return this.persistStatePromise;
  }

  async writeSyncStateToStorage() {
    const rootDirectoryHandle = await navigator.storage.getDirectory();
    const syncStateFileHandle = await rootDirectoryHandle.getFileHandle(SYNC_STATE_FILE_NAME, {
      create: true,
    });

    const writableStream = await syncStateFileHandle.createWritable();

    try {
      await writableStream.write(JSON.stringify(this.syncState));
    } finally {
      await writableStream.close();
    }
  }
}

class SyncError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "SyncError";
    this.statusCode = statusCode;
  }
}

async function loadSyncConfig() {
  try {
    const configModule = await import("../sync-config.js");
    return configModule.default ?? configModule;
  } catch (importError) {
    console.info(
      "Backend sync disabled: no sync-config.js found (copy sync-config.example.js to enable).",
    );
    return null;
  }
}

function resolveDeviceUserId() {
  try {
    const existingDeviceUserId = window.localStorage.getItem(DEVICE_USER_ID_STORAGE_KEY);

    if (existingDeviceUserId) {
      return existingDeviceUserId;
    }

    const generatedDeviceUserId = createDeviceUserId();
    window.localStorage.setItem(DEVICE_USER_ID_STORAGE_KEY, generatedDeviceUserId);
    return generatedDeviceUserId;
  } catch (storageError) {
    // localStorage unavailable; fall back to a per-session id.
    return createDeviceUserId();
  }
}

function createDeviceUserId() {
  const randomSuffix = Math.random().toString(16).slice(2, 10);
  return `device-${Date.now()}-${randomSuffix}`;
}

async function safeReadResponseText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "(no response body)";
  }
}

const syncService = new SyncService();

export default syncService;
