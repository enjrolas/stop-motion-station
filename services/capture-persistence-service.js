import frameStorageService from "./frame-storage-service.js";
import projectStorageService from "./project-storage-service.js";

class CapturePersistenceService {
  constructor() {
    this.worker = null;
    this.workerIsUnavailable = false;
    this.nextWorkerRequestId = 1;
    this.pendingWorkerRequests = new Map();
    this.pendingFrameAssetPersistencePromises = new Set();
    this.projectPersistenceQueuePromise = Promise.resolve();
  }

  supportsBackgroundCapturePipeline() {
    return this.hasWorkerRequirements() && Boolean(this.ensureWorker());
  }

  saveCapturedFrameAssets({
    frameId,
    sourceImageBitmap,
    timelineBlob,
    width,
    height,
  }) {
    const worker = this.ensureWorker();

    if (!worker) {
      return false;
    }

    const requestId = this.nextWorkerRequestId;
    this.nextWorkerRequestId += 1;

    const frameAssetPersistencePromise = new Promise((resolve, reject) => {
      this.pendingWorkerRequests.set(requestId, {
        resolve,
        reject,
      });
    });
    const trackedFrameAssetPersistencePromise = frameAssetPersistencePromise.finally(() => {
      this.pendingFrameAssetPersistencePromises.delete(trackedFrameAssetPersistencePromise);
    });

    trackedFrameAssetPersistencePromise.catch(() => {});
    this.pendingFrameAssetPersistencePromises.add(trackedFrameAssetPersistencePromise);

    try {
      worker.postMessage({
        type: "save-captured-frame-assets",
        requestId,
        frameId,
        sourceImageBitmap,
        timelineBlob,
        width,
        height,
      }, [sourceImageBitmap]);
    } catch (assetMessageError) {
      this.handleWorkerFailure(assetMessageError);
      throw assetMessageError;
    }

    return true;
  }

  persistProjectState(snapshot) {
    const queuedPersistencePromise = this.projectPersistenceQueuePromise
      .catch(() => {})
      .then(() => this.persistProjectStateInternal(snapshot));

    this.projectPersistenceQueuePromise = queuedPersistencePromise;
    return queuedPersistencePromise;
  }

  waitForPendingProjectPersistence() {
    return this.projectPersistenceQueuePromise.catch(() => {});
  }

  async waitForPendingFrameAssetPersistence() {
    await Promise.allSettled([...this.pendingFrameAssetPersistencePromises]);
  }

  async waitForPendingPersistence() {
    await Promise.allSettled([
      this.waitForPendingProjectPersistence(),
      this.waitForPendingFrameAssetPersistence(),
    ]);
  }

  async deleteFrameAssets({ originalStorageKey, thumbnailStorageKey }) {
    const worker = this.ensureWorker();

    if (!worker) {
      await this.deleteFrameAssetsOnMainThread({
        originalStorageKey,
        thumbnailStorageKey,
      });
      return;
    }

    await this.requestWorker({
      type: "delete-frame-assets",
      originalStorageKey,
      thumbnailStorageKey,
    });
  }

  hasWorkerRequirements() {
    return !this.workerIsUnavailable
      && typeof Worker !== "undefined"
      && typeof OffscreenCanvas !== "undefined"
      && typeof OffscreenCanvas.prototype.convertToBlob === "function"
      && typeof createImageBitmap === "function"
      && Boolean(navigator.storage?.getDirectory);
  }

  ensureWorker() {
    if (this.worker) {
      return this.worker;
    }

    if (this.workerIsUnavailable || !this.hasWorkerRequirements()) {
      return null;
    }

    try {
      this.worker = new Worker(
        new URL("./capture-persistence-worker.js", import.meta.url),
        { type: "module" },
      );
    } catch (workerCreationError) {
      this.workerIsUnavailable = true;
      console.warn("Capture persistence worker is unavailable:", workerCreationError);
      return null;
    }

    this.worker.addEventListener("message", (messageEvent) => {
      this.handleWorkerMessage(messageEvent.data);
    });

    this.worker.addEventListener("error", (workerErrorEvent) => {
      this.handleWorkerFailure(workerErrorEvent.error ?? workerErrorEvent.message);
    });

    return this.worker;
  }

  async persistProjectStateInternal(snapshot) {
    const worker = this.ensureWorker();

    if (!worker) {
      return projectStorageService.saveProject(snapshot);
    }

    // The worker writes the content file off-thread; the main thread then owns
    // the metadata-list update so it has a single serialized writer.
    await this.requestWorker({
      type: "persist-project-state",
      snapshot,
    });

    return projectStorageService.updateProjectMetadataFromFrames(snapshot);
  }

  requestWorker(message) {
    const worker = this.ensureWorker();

    if (!worker) {
      return Promise.reject(new Error("Capture persistence worker is unavailable."));
    }

    const requestId = this.nextWorkerRequestId;
    this.nextWorkerRequestId += 1;

    return new Promise((resolve, reject) => {
      this.pendingWorkerRequests.set(requestId, {
        resolve,
        reject,
      });

      worker.postMessage({
        ...message,
        requestId,
      });
    });
  }

  handleWorkerMessage(message) {
    if (message?.type === "project-persistence-complete") {
      this.resolveWorkerRequest(message.requestId, message.updatedProjectMetadata);
      return;
    }

    if (message?.type === "project-persistence-failed") {
      this.rejectWorkerRequest(message.requestId, createErrorFromWorkerMessage(message.error));
      return;
    }

    if (message?.type === "frame-assets-delete-complete") {
      this.resolveWorkerRequest(message.requestId);
      return;
    }

    if (message?.type === "frame-assets-delete-failed") {
      this.rejectWorkerRequest(message.requestId, createErrorFromWorkerMessage(message.error));
      return;
    }

    if (message?.type === "captured-frame-assets-saved") {
      this.resolveWorkerRequest(message.requestId, message);
      console.info("Captured frame assets saved", message);
      return;
    }

    if (message?.type === "captured-frame-assets-save-failed") {
      this.rejectWorkerRequest(message.requestId, createErrorFromWorkerMessage(message.error));
      console.error(
        "Failed to save captured frame assets:",
        message.frameId,
        createErrorFromWorkerMessage(message.error),
      );
    }
  }

  resolveWorkerRequest(requestId, result) {
    const pendingRequest = this.pendingWorkerRequests.get(requestId);

    if (!pendingRequest) {
      return;
    }

    this.pendingWorkerRequests.delete(requestId);
    pendingRequest.resolve(result);
  }

  rejectWorkerRequest(requestId, error) {
    const pendingRequest = this.pendingWorkerRequests.get(requestId);

    if (!pendingRequest) {
      return;
    }

    this.pendingWorkerRequests.delete(requestId);
    pendingRequest.reject(error);
  }

  handleWorkerFailure(workerError) {
    this.workerIsUnavailable = true;
    this.worker?.terminate();
    this.worker = null;

    for (const [requestId, pendingRequest] of this.pendingWorkerRequests.entries()) {
      this.pendingWorkerRequests.delete(requestId);
      pendingRequest.reject(workerError instanceof Error ? workerError : new Error(String(workerError)));
    }
  }

  async deleteFrameAssetsOnMainThread({ originalStorageKey, thumbnailStorageKey }) {
    await frameStorageService.deleteOriginalFrame({
      storageKey: originalStorageKey,
    });

    if (thumbnailStorageKey) {
      await frameStorageService.deleteThumbnailFrame({
        storageKey: thumbnailStorageKey,
      });
    }
  }
}

function createErrorFromWorkerMessage(errorMessage) {
  const error = new Error(errorMessage?.message ?? "Worker operation failed.");
  error.name = errorMessage?.name ?? "Error";
  error.stack = errorMessage?.stack ?? error.stack;
  return error;
}

const capturePersistenceService = new CapturePersistenceService();

export default capturePersistenceService;
