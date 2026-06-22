import assert from "node:assert/strict";
import test from "node:test";

import {
  MAXIMUM_PLAYBACK_FRAMES_PER_SECOND,
  MINIMUM_PLAYBACK_FRAMES_PER_SECOND,
  adjustPlaybackFramesPerSecond,
  canDeleteSelectedFrame,
  canPlayFrames,
  deleteSelectedFrame,
  ensureTimelineSelectionIsVisible,
  insertCapturedFrameAtCurrentSelection,
  moveSelectedFrameByOffset,
  moveTimelineSelectionByOffset,
} from "../helpers/frame-operations.js";
import { computeVisibleTimelineItemCount } from "../views/timeline-panel.js";

function createFrameRecord(id) {
  return {
    id,
    timelineImageSource: `${id}-timeline`,
    previewImageSource: `${id}-preview`,
    playbackImageSource: `${id}-playback`,
    originalStorageKey: `${id}.jpg`,
    thumbnailStorageKey: `${id}-timeline.jpg`,
    width: 640,
    height: 360,
  };
}

test("insertCapturedFrameAtCurrentSelection inserts at a selected gap", () => {
  const existingFrames = [createFrameRecord("first"), createFrameRecord("second")];
  const capturedFrameRecordData = createFrameRecord("inserted");

  const result = insertCapturedFrameAtCurrentSelection({
    frames: existingFrames,
    selectedTimelineItem: { type: "gap", index: 1 },
    capturedFrameRecordData,
  });

  assert.deepEqual(result.frames.map((frameRecord) => frameRecord.id), ["first", "inserted", "second"]);
  assert.equal(result.frames[1].playbackImageSource, "inserted-playback");
  assert.equal(result.frames[1].thumbnailStorageKey, "inserted-timeline.jpg");
  assert.deepEqual(result.selectedTimelineItem, { type: "gap", index: 2 });
  assert.equal(result.replacedFrameRecord, null);
});

test("insertCapturedFrameAtCurrentSelection replaces a selected frame", () => {
  const existingFrames = [createFrameRecord("first"), createFrameRecord("second")];
  const capturedFrameRecordData = createFrameRecord("replacement");

  const result = insertCapturedFrameAtCurrentSelection({
    frames: existingFrames,
    selectedTimelineItem: { type: "frame", index: 0 },
    capturedFrameRecordData,
  });

  assert.deepEqual(result.frames.map((frameRecord) => frameRecord.id), ["replacement", "second"]);
  assert.deepEqual(result.selectedTimelineItem, { type: "gap", index: 1 });
  assert.equal(result.replacedFrameRecord.id, "first");
});

test("deleteSelectedFrame deletes the selected frame or the frame behind a selected gap", () => {
  const existingFrames = [createFrameRecord("first"), createFrameRecord("second"), createFrameRecord("third")];

  const selectedFrameDeletionResult = deleteSelectedFrame({
    frames: existingFrames,
    selectedTimelineItem: { type: "frame", index: 1 },
  });

  assert.deepEqual(selectedFrameDeletionResult.frames.map((frameRecord) => frameRecord.id), ["first", "third"]);
  assert.deepEqual(selectedFrameDeletionResult.selectedTimelineItem, { type: "gap", index: 1 });
  assert.equal(selectedFrameDeletionResult.deletedFrameRecord.id, "second");

  const selectedGapDeletionResult = deleteSelectedFrame({
    frames: existingFrames,
    selectedTimelineItem: { type: "gap", index: 2 },
  });

  assert.deepEqual(selectedGapDeletionResult.frames.map((frameRecord) => frameRecord.id), ["first", "third"]);
  assert.deepEqual(selectedGapDeletionResult.selectedTimelineItem, { type: "gap", index: 1 });
  assert.equal(selectedGapDeletionResult.deletedFrameRecord.id, "second");
});

test("canDeleteSelectedFrame only allows frames and gaps after a frame", () => {
  assert.equal(canDeleteSelectedFrame({ selectedTimelineItem: { type: "frame", index: 0 } }), true);
  assert.equal(canDeleteSelectedFrame({ selectedTimelineItem: { type: "gap", index: 1 } }), true);
  assert.equal(canDeleteSelectedFrame({ selectedTimelineItem: { type: "gap", index: 0 } }), false);
});

test("canPlayFrames requires at least one frame", () => {
  assert.equal(canPlayFrames({ frames: [] }), false);
  assert.equal(canPlayFrames({ frames: [createFrameRecord("first")] }), true);
});

test("adjustPlaybackFramesPerSecond changes speed within the supported range", () => {
  assert.equal(adjustPlaybackFramesPerSecond({ framesPerSecond: 8, adjustment: 1 }), 9);
  assert.equal(adjustPlaybackFramesPerSecond({ framesPerSecond: 8, adjustment: -1 }), 7);
  assert.equal(
    adjustPlaybackFramesPerSecond({
      framesPerSecond: MAXIMUM_PLAYBACK_FRAMES_PER_SECOND,
      adjustment: 1,
    }),
    MAXIMUM_PLAYBACK_FRAMES_PER_SECOND,
  );
  assert.equal(
    adjustPlaybackFramesPerSecond({
      framesPerSecond: MINIMUM_PLAYBACK_FRAMES_PER_SECOND,
      adjustment: -1,
    }),
    MINIMUM_PLAYBACK_FRAMES_PER_SECOND,
  );
});

test("moveSelectedFrameByOffset swaps selected frames within bounds", () => {
  const result = moveSelectedFrameByOffset({
    frames: [createFrameRecord("first"), createFrameRecord("second")],
    selectedTimelineItem: { type: "frame", index: 0 },
    movementOffset: 1,
  });

  assert.equal(result.didMoveFrame, true);
  assert.deepEqual(result.frames.map((frameRecord) => frameRecord.id), ["second", "first"]);
  assert.deepEqual(result.selectedTimelineItem, { type: "frame", index: 1 });
});

test("moveTimelineSelectionByOffset walks across gaps and frames", () => {
  const result = moveTimelineSelectionByOffset({
    frames: [createFrameRecord("first"), createFrameRecord("second")],
    selectedTimelineItem: { type: "gap", index: 0 },
    movementOffset: 1,
  });

  assert.equal(result.didMoveSelection, true);
  assert.deepEqual(result.selectedTimelineItem, { type: "frame", index: 0 });
});

test("ensureTimelineSelectionIsVisible clamps to the available timeline", () => {
  const scrollOffset = ensureTimelineSelectionIsVisible({
    selectedTimelineItem: { type: "frame", index: 9 },
    currentTimelineScrollOffsetInItemUnits: 0,
    visibleTimelineItemCount: 5,
    frameCount: 10,
  });

  assert.equal(scrollOffset, 15);
});

test("computeVisibleTimelineItemCount scales with the rendered timeline width", () => {
  assert.equal(
    Math.round(computeVisibleTimelineItemCount({ timelinePanelWidth: 1025 })),
    15,
  );
});

test("ensureTimelineSelectionIsVisible keeps the timeline end at the right edge on wide layouts", () => {
  const visibleTimelineItemCount = computeVisibleTimelineItemCount({
    timelinePanelWidth: 1025,
  });
  const scrollOffset = ensureTimelineSelectionIsVisible({
    selectedTimelineItem: { type: "gap", index: 20 },
    currentTimelineScrollOffsetInItemUnits: 0,
    visibleTimelineItemCount,
    frameCount: 20,
  });

  assert.equal(Math.round(scrollOffset), 26);
});
