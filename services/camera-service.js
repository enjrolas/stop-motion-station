class CameraService {
  constructor() {
    this.videoElement = document.createElement("video");
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;

    this.captureCanvasElement = document.createElement("canvas");
    this.captureRenderingContext = this.captureCanvasElement.getContext("2d", {
      alpha: false,
    });

    this.thumbnailCanvasElement = document.createElement("canvas");
    this.thumbnailRenderingContext = this.thumbnailCanvasElement.getContext("2d", {
      alpha: false,
    });

    this.mediaStream = null;
    this.hasStartedPreview = false;
    this.startPreviewPromise = null;
  }

  async startPreview() {
    if (this.hasStartedPreview) {
      return;
    }

    if (this.startPreviewPromise) {
      return this.startPreviewPromise;
    }

    this.startPreviewPromise = this.startPreviewInternal();

    try {
      await this.startPreviewPromise;
      this.hasStartedPreview = true;
    } finally {
      this.startPreviewPromise = null;
    }
  }

  async startPreviewInternal() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API unavailable. Use HTTPS or localhost in a supported browser.");
    }

    const requestedAspectRatio = 16 / 9;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        aspectRatio: { ideal: requestedAspectRatio },
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 360 },
      },
      audio: false,
    });

    this.videoElement.srcObject = this.mediaStream;
  }

  getVideoElement() {
    return this.videoElement;
  }

  ensurePreviewIsPlaying() {
    if (!this.videoElement.srcObject) {
      return;
    }

    this.videoElement.muted = true;
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;

    if (this.videoElement.paused) {
      this.videoElement.play().catch((previewPlaybackError) => {
        console.error("Failed to start preview playback:", previewPlaybackError);
      });
    }
  }

  supportsFastCapturePipeline() {
    return typeof createImageBitmap === "function" && typeof URL.createObjectURL === "function";
  }

  async captureFramePreviewDataForBackgroundPersistence() {
    const captureStartedAtMilliseconds = performance.now();
    const frameWidth = this.videoElement.videoWidth;
    const frameHeight = this.videoElement.videoHeight;

    if (!frameWidth || !frameHeight) {
      throw new Error("Camera preview is not ready to capture a frame yet.");
    }

    if (!this.supportsFastCapturePipeline()) {
      throw new Error("Fast capture pipeline is unavailable in this browser.");
    }

    const sourceImageBitmap = await createImageBitmap(this.videoElement);
    const timelineSize = createTimelineFrameSize({
      frameWidth,
      frameHeight,
    });

    if (this.thumbnailCanvasElement.width !== timelineSize.width) {
      this.thumbnailCanvasElement.width = timelineSize.width;
    }

    if (this.thumbnailCanvasElement.height !== timelineSize.height) {
      this.thumbnailCanvasElement.height = timelineSize.height;
    }

    drawImageWithBothAxesFlipped({
      renderingContext: this.thumbnailRenderingContext,
      sourceImage: sourceImageBitmap,
      sourceWidth: frameWidth,
      sourceHeight: frameHeight,
      targetWidth: timelineSize.width,
      targetHeight: timelineSize.height,
    });

    const timelineBlob = await canvasToBlob(
      this.thumbnailCanvasElement,
      "image/jpeg",
      0.8,
    );

    const timelineImageSource = URL.createObjectURL(timelineBlob);
    const captureDurationMilliseconds = performance.now() - captureStartedAtMilliseconds;

    return {
      sourceImageBitmap,
      timelineBlob,
      timelineImageSource,
      previewImageSource: timelineImageSource,
      timelineBlobSizeInBytes: timelineBlob.size,
      captureDurationMilliseconds,
      width: frameWidth,
      height: frameHeight,
    };
  }

  async captureFrameRecordData() {
    const captureStartedAtMilliseconds = performance.now();
    const frameWidth = this.videoElement.videoWidth;
    const frameHeight = this.videoElement.videoHeight;

    if (!frameWidth || !frameHeight) {
      throw new Error("Camera preview is not ready to capture a frame yet.");
    }

    if (this.captureCanvasElement.width !== frameWidth) {
      this.captureCanvasElement.width = frameWidth;
    }

    if (this.captureCanvasElement.height !== frameHeight) {
      this.captureCanvasElement.height = frameHeight;
    }

    drawImageWithBothAxesFlipped({
      renderingContext: this.captureRenderingContext,
      sourceImage: this.videoElement,
      sourceWidth: frameWidth,
      sourceHeight: frameHeight,
      targetWidth: frameWidth,
      targetHeight: frameHeight,
    });

    const originalBlob = await canvasToBlob(
      this.captureCanvasElement,
      "image/jpeg",
      0.9,
    );

    const timelineSize = createTimelineFrameSize({
      frameWidth,
      frameHeight,
    });

    if (this.thumbnailCanvasElement.width !== timelineSize.width) {
      this.thumbnailCanvasElement.width = timelineSize.width;
    }

    if (this.thumbnailCanvasElement.height !== timelineSize.height) {
      this.thumbnailCanvasElement.height = timelineSize.height;
    }

    this.thumbnailRenderingContext.drawImage(
      this.captureCanvasElement,
      0,
      0,
      frameWidth,
      frameHeight,
      0,
      0,
      timelineSize.width,
      timelineSize.height,
    );

    const timelineBlob = await canvasToBlob(
      this.thumbnailCanvasElement,
      "image/jpeg",
      0.8,
    );

    const timelineImageSource = await blobToDataUrl(timelineBlob);
    const captureDurationMilliseconds = performance.now() - captureStartedAtMilliseconds;

    return {
      timelineImageSource,
      previewImageSource: timelineImageSource,
      originalBlob,
      originalBlobSizeInBytes: originalBlob.size,
      timelineBlobSizeInBytes: timelineBlob.size,
      captureDurationMilliseconds,
      width: frameWidth,
      height: frameHeight,
    };
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

function createTimelineFrameSize({ frameWidth, frameHeight }) {
  const timelineMaximumWidth = 320;
  const timelineMaximumHeight = 180;

  return fitWithinBounds({
    sourceWidth: frameWidth,
    sourceHeight: frameHeight,
    maximumWidth: timelineMaximumWidth,
    maximumHeight: timelineMaximumHeight,
  });
}

function canvasToBlob(canvasElement, type, quality) {
  return new Promise((resolve, reject) => {
    canvasElement.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode canvas image."));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();

    fileReader.onload = () => {
      if (typeof fileReader.result === "string") {
        resolve(fileReader.result);
        return;
      }

      reject(new Error("Failed to convert blob to a data URL string."));
    };

    fileReader.onerror = () => {
      reject(fileReader.error ?? new Error("Failed to read blob as data URL."));
    };

    fileReader.readAsDataURL(blob);
  });
}

function fitWithinBounds({
  sourceWidth,
  sourceHeight,
  maximumWidth,
  maximumHeight,
}) {
  const scale = Math.min(
    maximumWidth / sourceWidth,
    maximumHeight / sourceHeight,
  );

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

const cameraService = new CameraService();
window.cameraService = cameraService;

export default cameraService;
