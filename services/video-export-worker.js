import { ArrayBufferTarget, Muxer } from "../lib/mp4-muxer.mjs";
import frameStorageService from "./frame-storage-service.js";

// Candidate H.264 profiles/levels, most capable first. The first configuration
// the platform supports is used. Level 4.0 covers 1080p30; 3.1 covers 720p30.
const H264_CODEC_CANDIDATES = ["avc1.640028", "avc1.4D4028", "avc1.42E01F"];
const MAX_ENCODE_QUEUE_DEPTH = 8;

let activeEncodeRequestId = null;

self.addEventListener("message", (messageEvent) => {
  const message = messageEvent.data;

  if (message?.type === "encode-video") {
    activeEncodeRequestId = message.requestId;
    encodeVideo(message).catch((encodeError) => {
      self.postMessage({
        type: "video-encode-failed",
        requestId: message.requestId,
        error: serializeError(encodeError),
      });
    });
    return;
  }

  if (message?.type === "cancel-encode") {
    if (message.requestId === activeEncodeRequestId) {
      activeEncodeRequestId = null;
    }
  }
});

function isRequestCancelled(requestId) {
  return activeEncodeRequestId !== requestId;
}

async function encodeVideo({ requestId, frames, framesPerSecond }) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    self.postMessage({
      type: "video-encode-unsupported",
      requestId,
      reason: "WebCodecs VideoEncoder is unavailable in this browser.",
    });
    return;
  }

  if (!Array.isArray(frames) || frames.length === 0) {
    self.postMessage({ type: "video-encode-failed", requestId, error: { message: "No frames to encode." } });
    return;
  }

  const effectiveFramesPerSecond = Math.max(1, framesPerSecond || 8);

  // Use the first frame to establish the (even) output dimensions.
  const firstFrameBitmap = await readFrameBitmap(frames[0].storageKey);
  const targetWidth = roundDownToEven(firstFrameBitmap.width);
  const targetHeight = roundDownToEven(firstFrameBitmap.height);
  firstFrameBitmap.close();

  const codec = await pickSupportedCodec({ targetWidth, targetHeight, effectiveFramesPerSecond });

  if (!codec) {
    self.postMessage({
      type: "video-encode-unsupported",
      requestId,
      reason: "No supported H.264 encoder configuration was found.",
    });
    return;
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: targetWidth, height: targetHeight },
    fastStart: "in-memory",
  });

  const videoEncoder = new VideoEncoder({
    output: (encodedChunk, chunkMetadata) => muxer.addVideoChunk(encodedChunk, chunkMetadata),
    error: (encoderError) => {
      self.postMessage({
        type: "video-encode-failed",
        requestId,
        error: serializeError(encoderError),
      });
    },
  });

  videoEncoder.configure({
    codec,
    width: targetWidth,
    height: targetHeight,
    bitrate: computeBitrate({ targetWidth, targetHeight, effectiveFramesPerSecond }),
    framerate: effectiveFramesPerSecond,
  });

  const drawingCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const drawingContext = drawingCanvas.getContext("2d", { alpha: false });
  const microsecondsPerFrame = Math.round(1_000_000 / effectiveFramesPerSecond);
  const keyFrameInterval = Math.max(1, Math.round(effectiveFramesPerSecond * 2));

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    if (isRequestCancelled(requestId)) {
      videoEncoder.close();
      self.postMessage({ type: "video-encode-cancelled", requestId });
      return;
    }

    const frameBitmap = await readFrameBitmap(frames[frameIndex].storageKey);
    drawingContext.drawImage(frameBitmap, 0, 0, targetWidth, targetHeight);
    frameBitmap.close();

    const videoFrame = new VideoFrame(drawingCanvas, {
      timestamp: frameIndex * microsecondsPerFrame,
      duration: microsecondsPerFrame,
    });

    videoEncoder.encode(videoFrame, { keyFrame: frameIndex % keyFrameInterval === 0 });
    videoFrame.close();

    // Apply backpressure so memory does not balloon on long sequences.
    while (videoEncoder.encodeQueueSize > MAX_ENCODE_QUEUE_DEPTH) {
      await waitForMicrotask();
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();

  if (isRequestCancelled(requestId)) {
    self.postMessage({ type: "video-encode-cancelled", requestId });
    return;
  }

  const { buffer } = muxer.target;
  const durationSeconds = (frames.length * microsecondsPerFrame) / 1_000_000;

  activeEncodeRequestId = null;
  self.postMessage(
    {
      type: "video-encoded",
      requestId,
      buffer,
      byteLength: buffer.byteLength,
      width: targetWidth,
      height: targetHeight,
      framesPerSecond: effectiveFramesPerSecond,
      durationSeconds,
    },
    [buffer],
  );
}

async function readFrameBitmap(storageKey) {
  const frameFile = await frameStorageService.readOriginalFrameFile({ storageKey });
  return createImageBitmap(frameFile);
}

async function pickSupportedCodec({ targetWidth, targetHeight, effectiveFramesPerSecond }) {
  for (const codec of H264_CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: targetWidth,
        height: targetHeight,
        bitrate: computeBitrate({ targetWidth, targetHeight, effectiveFramesPerSecond }),
        framerate: effectiveFramesPerSecond,
      });

      if (support?.supported) {
        return codec;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function computeBitrate({ targetWidth, targetHeight, effectiveFramesPerSecond }) {
  const estimatedBitrate = Math.round(targetWidth * targetHeight * effectiveFramesPerSecond * 0.2);
  return Math.min(20_000_000, Math.max(2_000_000, estimatedBitrate));
}

function roundDownToEven(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function waitForMicrotask() {
  return new Promise((resolveMicrotask) => {
    setTimeout(resolveMicrotask, 0);
  });
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? "Unknown video encode error",
    stack: error?.stack ?? null,
  };
}
