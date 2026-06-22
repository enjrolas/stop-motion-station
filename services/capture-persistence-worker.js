import frameStorageService, {
  createOriginalFrameStorageKey,
  createThumbnailFrameStorageKey,
} from "./frame-storage-service.js";
import projectStorageService from "./project-storage-service.js";

let backgroundQueuePromise = Promise.resolve();

self.addEventListener("message", (messageEvent) => {
  const message = messageEvent.data;

  if (message?.type === "save-captured-frame-assets") {
    enqueueBackgroundOperation(async () => {
      await saveCapturedFrameAssets(message);
    }).catch((saveError) => {
      self.postMessage({
        type: "captured-frame-assets-save-failed",
        frameId: message.frameId,
        error: serializeError(saveError),
      });
    });
    return;
  }

  if (message?.type === "persist-project-state") {
    enqueueBackgroundOperation(async () => {
      const updatedProjectMetadata = await projectStorageService.saveProject(message.snapshot);

      self.postMessage({
        type: "project-persistence-complete",
        requestId: message.requestId,
        updatedProjectMetadata,
      });
    }).catch((persistenceError) => {
      self.postMessage({
        type: "project-persistence-failed",
        requestId: message.requestId,
        error: serializeError(persistenceError),
      });
    });
    return;
  }

  if (message?.type === "delete-frame-assets") {
    enqueueBackgroundOperation(async () => {
      await deleteFrameAssets(message);

      self.postMessage({
        type: "frame-assets-delete-complete",
        requestId: message.requestId,
      });
    }).catch((deleteError) => {
      self.postMessage({
        type: "frame-assets-delete-failed",
        requestId: message.requestId,
        error: serializeError(deleteError),
      });
    });
  }
});

function enqueueBackgroundOperation(operation) {
  const queuedOperationPromise = backgroundQueuePromise
    .catch(() => {})
    .then(operation);

  backgroundQueuePromise = queuedOperationPromise;
  return queuedOperationPromise;
}

async function saveCapturedFrameAssets({
  frameId,
  sourceImageBitmap,
  timelineBlob,
  width,
  height,
}) {
  const operationStartedAtMilliseconds = performance.now();
  const originalStorageKey = createOriginalFrameStorageKey(frameId);
  const thumbnailStorageKey = createThumbnailFrameStorageKey(frameId);
  let originalBlob = null;

  try {
    originalBlob = await encodeOriginalFrameBlob({
      sourceImageBitmap,
      width,
      height,
    });
  } finally {
    sourceImageBitmap?.close?.();
  }

  const encodeDurationMilliseconds = performance.now() - operationStartedAtMilliseconds;
  const saveStartedAtMilliseconds = performance.now();

  await frameStorageService.saveThumbnailFrameBlob({
    storageKey: thumbnailStorageKey,
    blob: timelineBlob,
  });

  await frameStorageService.saveOriginalFrameBlob({
    storageKey: originalStorageKey,
    blob: originalBlob,
  });

  const saveDurationMilliseconds = performance.now() - saveStartedAtMilliseconds;

  self.postMessage({
    type: "captured-frame-assets-saved",
    frameId,
    originalStorageKey,
    thumbnailStorageKey,
    originalBlobSizeInBytes: originalBlob.size,
    timelineBlobSizeInBytes: timelineBlob.size,
    encodeDurationMilliseconds,
    saveDurationMilliseconds,
    totalDurationMilliseconds: performance.now() - operationStartedAtMilliseconds,
  });
}

async function encodeOriginalFrameBlob({
  sourceImageBitmap,
  width,
  height,
}) {
  const captureCanvasElement = new OffscreenCanvas(width, height);
  const captureRenderingContext = captureCanvasElement.getContext("2d", {
    alpha: false,
  });

  drawImageWithBothAxesFlipped({
    renderingContext: captureRenderingContext,
    sourceImage: sourceImageBitmap,
    sourceWidth: width,
    sourceHeight: height,
    targetWidth: width,
    targetHeight: height,
  });

  return captureCanvasElement.convertToBlob({
    type: "image/jpeg",
    quality: 0.9,
  });
}

async function deleteFrameAssets({
  originalStorageKey,
  thumbnailStorageKey,
}) {
  await frameStorageService.deleteOriginalFrame({
    storageKey: originalStorageKey,
  });

  if (thumbnailStorageKey) {
    await frameStorageService.deleteThumbnailFrame({
      storageKey: thumbnailStorageKey,
    });
  }
}

function drawImageWithBothAxesFlipped({
  renderingContext,
  sourceImage,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
}) {
  renderingContext.save();
  renderingContext.translate(targetWidth, targetHeight);
  renderingContext.scale(-1, -1);
  renderingContext.drawImage(
    sourceImage,
    0,
    0,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  renderingContext.restore();
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? "Unknown error",
    stack: error?.stack ?? null,
  };
}
