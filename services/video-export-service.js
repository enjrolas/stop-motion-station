import projectStorageService from "./project-storage-service.js";
import syncService from "./sync-service.js";
import { createFramesSignature, shouldEncodeNow } from "../helpers/video-export-policy.js";

const VIDEO_EXPORT_STATE_FILE_NAME = "video-export-state.json";

// Renders a project's frames into an MP4 on a background worker (WebCodecs) and
// uploads it through the sync layer. The encode is low priority: it only starts
// when the UI has been idle, never blocking capture or playback.
class VideoExportService {
  constructor() {
    this.worker = null;
    this.workerIsUnavailable = false;
    this.encoderIsUnsupported = false;

    this.isEncoding = false;
    this.activeEncode = null;
    this.nextEncodeRequestId = 1;

    this.exportState = { version: 1, projects: {} };
    this.hasLoadedExportState = false;
    this.persistStatePromise = Promise.resolve();

    this.status = { state: "idle", message: "Video export idle." };
    this.statusListener = null;
  }

  setStatusListener(statusListener) {
    this.statusListener = statusListener;
  }

  getStatus() {
    return { ...this.status };
  }

  updateStatus(partialStatus) {
    this.status = { ...this.status, ...partialStatus };

    if (this.statusListener) {
      this.statusListener(this.getStatus());
    }
  }

  isSupported() {
    // Uploading the result needs the backend; encoding needs Workers. Actual
    // WebCodecs support is probed inside the worker (reports back if missing).
    return (
      !this.workerIsUnavailable
      && !this.encoderIsUnsupported
      && typeof Worker !== "undefined"
      && syncService.isEnabled()
    );
  }

  async maybeEncodeOnIdle({
    projectId,
    frames,
    framesPerSecond,
    isPlaying,
    isTimelapseCapturing,
    isCaptureInProgress,
    nowMilliseconds,
    lastActivityAtMilliseconds,
  }) {
    if (!this.isSupported() || !projectId) {
      return;
    }

    await this.loadExportState();

    const currentSignature = createFramesSignature({ frames, framesPerSecond });
    const lastEncodedSignature = this.exportState.projects[projectId]?.encodedSignature ?? null;

    const decision = shouldEncodeNow({
      nowMilliseconds,
      lastActivityAtMilliseconds,
      isPlaying,
      isTimelapseCapturing,
      isCaptureInProgress,
      isEncodeInProgress: this.isEncoding,
      hasEncodableProject: true,
      frameCount: Array.isArray(frames) ? frames.length : 0,
      currentSignature,
      lastEncodedSignature,
    });

    if (!decision) {
      return;
    }

    await this.startEncode({ projectId, framesPerSecond });
  }

  async startEncode({ projectId, framesPerSecond }) {
    if (this.isEncoding) {
      return;
    }

    // Re-read the persisted project so we encode the authoritative frame order
    // and only reference frame images that are actually on disk.
    let loadedProject;
    try {
      loadedProject = await projectStorageService.loadProject({ projectId });
    } catch {
      return;
    }

    const signature = createFramesSignature({
      frames: loadedProject.frames,
      framesPerSecond,
    });

    if (signature === (this.exportState.projects[projectId]?.encodedSignature ?? null)) {
      return;
    }

    const workerFrames = [];
    for (const frameRecord of loadedProject.frames) {
      if (!frameRecord?.originalStorageKey) {
        // A frame image is not persisted yet; try again on a later idle tick.
        return;
      }
      workerFrames.push({ storageKey: frameRecord.originalStorageKey });
    }

    if (workerFrames.length < 2) {
      return;
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return;
    }

    const requestId = this.nextEncodeRequestId;
    this.nextEncodeRequestId += 1;
    this.isEncoding = true;
    this.activeEncode = { requestId, projectId, signature };
    this.updateStatus({ state: "rendering", message: "Rendering video in the background…" });

    worker.postMessage({
      type: "encode-video",
      requestId,
      frames: workerFrames,
      framesPerSecond,
    });
  }

  notifyFramesChanged(projectId) {
    if (!projectId) {
      return;
    }

    // Abandon an in-flight encode that is now stale.
    if (this.isEncoding && this.activeEncode?.projectId === projectId) {
      this.worker?.postMessage({ type: "cancel-encode", requestId: this.activeEncode.requestId });
      this.isEncoding = false;
      this.activeEncode = null;
      this.updateStatus({ state: "idle", message: "Video export idle." });
    }

    // Best-effort: if a rendered video was already uploaded for this project,
    // tell the backend its stored film is now out of date. Skip otherwise to
    // avoid a no-op request on every capture before any video exists.
    const hasUploadedVideo = Boolean(this.exportState.projects[projectId]?.encodedSignature);

    if (this.isSupported() && hasUploadedVideo) {
      syncService.markProjectVideoChanged(projectId).catch(() => {});
    }
  }

  ensureWorker() {
    if (this.worker) {
      return this.worker;
    }

    if (this.workerIsUnavailable || typeof Worker === "undefined") {
      return null;
    }

    try {
      this.worker = new Worker(
        new URL("./video-export-worker.js", import.meta.url),
        { type: "module" },
      );
    } catch (workerCreationError) {
      this.workerIsUnavailable = true;
      console.warn("Video export worker is unavailable:", workerCreationError);
      return null;
    }

    this.worker.addEventListener("message", (messageEvent) => {
      this.handleWorkerMessage(messageEvent.data);
    });

    this.worker.addEventListener("error", (workerErrorEvent) => {
      console.warn("Video export worker error:", workerErrorEvent.message);
      this.isEncoding = false;
      this.activeEncode = null;
      this.updateStatus({ state: "error", message: "Video render failed." });
    });

    return this.worker;
  }

  handleWorkerMessage(message) {
    if (!message || message.requestId !== this.activeEncode?.requestId) {
      return;
    }

    if (message.type === "video-encoded") {
      this.handleEncodedVideo(message);
      return;
    }

    if (message.type === "video-encode-unsupported") {
      this.encoderIsUnsupported = true;
      this.isEncoding = false;
      this.activeEncode = null;
      this.updateStatus({ state: "unsupported", message: "Video encoding is not supported here." });
      return;
    }

    if (message.type === "video-encode-cancelled") {
      this.isEncoding = false;
      this.activeEncode = null;
      return;
    }

    if (message.type === "video-encode-failed") {
      console.warn("Video encode failed:", message.error?.message);
      this.isEncoding = false;
      this.activeEncode = null;
      this.updateStatus({ state: "error", message: "Video render failed — will retry when idle." });
    }
  }

  async handleEncodedVideo(message) {
    const completedEncode = this.activeEncode;
    this.isEncoding = false;
    this.activeEncode = null;

    if (!completedEncode) {
      return;
    }

    const videoBlob = new Blob([message.buffer], { type: "video/mp4" });
    this.updateStatus({ state: "uploading", message: "Uploading rendered video…" });

    try {
      await syncService.uploadProjectVideo({
        projectId: completedEncode.projectId,
        videoBlob,
        durationSeconds: message.durationSeconds,
      });

      this.exportState.projects[completedEncode.projectId] = {
        encodedSignature: completedEncode.signature,
      };
      await this.saveExportState();

      this.updateStatus({ state: "uploaded", message: "Video synced to the backend." });
    } catch (uploadError) {
      console.warn("Video upload failed:", uploadError);
      this.updateStatus({ state: "error", message: "Video upload failed — will retry when idle." });
    }
  }

  async loadExportState() {
    if (this.hasLoadedExportState) {
      return;
    }

    try {
      const rootDirectoryHandle = await navigator.storage.getDirectory();
      const stateFileHandle = await rootDirectoryHandle.getFileHandle(VIDEO_EXPORT_STATE_FILE_NAME);
      const stateFile = await stateFileHandle.getFile();
      const stateText = await stateFile.text();

      if (stateText.trim()) {
        const parsedState = JSON.parse(stateText);

        if (parsedState && typeof parsedState.projects === "object") {
          this.exportState = { version: 1, projects: parsedState.projects ?? {} };
        }
      }
    } catch (loadError) {
      if (loadError?.name !== "NotFoundError") {
        console.warn("Could not load video export state:", loadError);
      }
    }

    this.hasLoadedExportState = true;
  }

  saveExportState() {
    this.persistStatePromise = this.persistStatePromise
      .catch(() => {})
      .then(() => this.writeExportStateToStorage());
    return this.persistStatePromise;
  }

  async writeExportStateToStorage() {
    const rootDirectoryHandle = await navigator.storage.getDirectory();
    const stateFileHandle = await rootDirectoryHandle.getFileHandle(VIDEO_EXPORT_STATE_FILE_NAME, {
      create: true,
    });

    const writableStream = await stateFileHandle.createWritable();

    try {
      await writableStream.write(JSON.stringify(this.exportState));
    } finally {
      await writableStream.close();
    }
  }
}

const videoExportService = new VideoExportService();

export default videoExportService;
