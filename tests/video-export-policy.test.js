import assert from "node:assert/strict";
import test from "node:test";

import {
  createFramesSignature,
  shouldEncodeNow,
  DEFAULT_VIDEO_EXPORT_IDLE_THRESHOLD_MILLISECONDS,
} from "../helpers/video-export-policy.js";

const baseFrames = [{ id: "frame-a" }, { id: "frame-b" }, { id: "frame-c" }];

function encodeArguments(overrides = {}) {
  return {
    nowMilliseconds: 100000,
    lastActivityAtMilliseconds: 100000 - DEFAULT_VIDEO_EXPORT_IDLE_THRESHOLD_MILLISECONDS,
    isPlaying: false,
    isTimelapseCapturing: false,
    isCaptureInProgress: false,
    isEncodeInProgress: false,
    hasEncodableProject: true,
    frameCount: 3,
    currentSignature: "8@frame-a,frame-b,frame-c",
    lastEncodedSignature: null,
    ...overrides,
  };
}

test("createFramesSignature changes with frame order and playback speed", () => {
  const signature = createFramesSignature({ frames: baseFrames, framesPerSecond: 8 });

  assert.equal(signature, "8@frame-a,frame-b,frame-c");
  assert.notEqual(
    signature,
    createFramesSignature({ frames: [...baseFrames].reverse(), framesPerSecond: 8 }),
  );
  assert.notEqual(
    signature,
    createFramesSignature({ frames: baseFrames, framesPerSecond: 12 }),
  );
});

test("createFramesSignature is stable for identical inputs", () => {
  assert.equal(
    createFramesSignature({ frames: baseFrames, framesPerSecond: 8 }),
    createFramesSignature({ frames: baseFrames, framesPerSecond: 8 }),
  );
});

test("shouldEncodeNow encodes once idle, stale, and not busy", () => {
  assert.equal(shouldEncodeNow(encodeArguments()), true);
});

test("shouldEncodeNow waits until the idle threshold elapses", () => {
  assert.equal(
    shouldEncodeNow(encodeArguments({ lastActivityAtMilliseconds: 100000 - 4000 })),
    false,
  );
  assert.equal(
    shouldEncodeNow(encodeArguments({ lastActivityAtMilliseconds: 100000 - 5000 })),
    true,
  );
});

test("shouldEncodeNow never encodes while playing, capturing, or running a timelapse", () => {
  assert.equal(shouldEncodeNow(encodeArguments({ isPlaying: true })), false);
  assert.equal(shouldEncodeNow(encodeArguments({ isTimelapseCapturing: true })), false);
  assert.equal(shouldEncodeNow(encodeArguments({ isCaptureInProgress: true })), false);
});

test("shouldEncodeNow skips when an encode is already running", () => {
  assert.equal(shouldEncodeNow(encodeArguments({ isEncodeInProgress: true })), false);
});

test("shouldEncodeNow skips when the video already matches the current frames", () => {
  assert.equal(
    shouldEncodeNow(encodeArguments({ lastEncodedSignature: "8@frame-a,frame-b,frame-c" })),
    false,
  );
});

test("shouldEncodeNow requires at least two frames and an encodable project", () => {
  assert.equal(shouldEncodeNow(encodeArguments({ frameCount: 1 })), false);
  assert.equal(shouldEncodeNow(encodeArguments({ hasEncodableProject: false })), false);
});
