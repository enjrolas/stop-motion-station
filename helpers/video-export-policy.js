export const DEFAULT_VIDEO_EXPORT_IDLE_THRESHOLD_MILLISECONDS = 5000;
export const MINIMUM_VIDEO_EXPORT_FRAME_COUNT = 2;

// A stable fingerprint of everything that affects the rendered video: the
// ordered frame identity and the playback rate. When this changes, the project's
// exported video is stale and should be re-encoded.
export function createFramesSignature({ frames, framesPerSecond }) {
  const orderedFrameKeys = (Array.isArray(frames) ? frames : []).map(
    (frameRecord) => frameRecord?.id ?? frameRecord?.originalStorageKey ?? "?",
  );

  return `${framesPerSecond ?? 0}@${orderedFrameKeys.join(",")}`;
}

// Decide whether the background video encode should start right now. The encode
// is intentionally low priority: it only runs once the UI has been idle for the
// threshold, never while the user is actively playing, capturing, or running a
// timelapse, and only when the current frames differ from what was last encoded.
export function shouldEncodeNow({
  nowMilliseconds,
  lastActivityAtMilliseconds,
  idleThresholdMilliseconds = DEFAULT_VIDEO_EXPORT_IDLE_THRESHOLD_MILLISECONDS,
  isPlaying = false,
  isTimelapseCapturing = false,
  isCaptureInProgress = false,
  isEncodeInProgress = false,
  hasEncodableProject = false,
  frameCount = 0,
  minimumFrameCount = MINIMUM_VIDEO_EXPORT_FRAME_COUNT,
  currentSignature,
  lastEncodedSignature,
}) {
  if (!hasEncodableProject || isEncodeInProgress) {
    return false;
  }

  if (isPlaying || isTimelapseCapturing || isCaptureInProgress) {
    return false;
  }

  if (frameCount < minimumFrameCount) {
    return false;
  }

  if (currentSignature === lastEncodedSignature) {
    return false;
  }

  const idleElapsedMilliseconds = nowMilliseconds - lastActivityAtMilliseconds;
  return idleElapsedMilliseconds >= idleThresholdMilliseconds;
}
