export const DEFAULT_PLAYBACK_FRAMES_PER_SECOND = 8;
export const MINIMUM_PLAYBACK_FRAMES_PER_SECOND = 1;
export const MAXIMUM_PLAYBACK_FRAMES_PER_SECOND = 24;

export function createInitialApplicationState() {
  return {
    appMode: "project-browser",
    cameraStatus: "idle",
    cameraErrorMessage: null,
    cameraStartupWaitingForUserGesture: false,
    frames: [],
    projects: [],
    selectedProjectBrowserIndex: 0,
    projectBrowserModalProjectId: null,
    projectBrowserModalSelectedActionIndex: 0,
    projectBrowserModalStatusMessage: null,
    projectBrowserTitleEditor: {
      isActive: false,
      draftTitle: "",
      selectedKeyIndex: 0,
    },
    projectBrowserColumnCount: 1,
    currentProjectId: null,
    currentProjectTitle: null,
    selectedTimelineItem: {
      type: "gap",
      index: 0,
    },
    timelineScrollOffsetInItemUnits: 0,
    timelineScrollTargetOffsetInItemUnits: 0,
    visibleTimelineItemCount: 9,
    isPlaying: false,
    playbackFrameIndex: null,
    playbackFramesPerSecond: DEFAULT_PLAYBACK_FRAMES_PER_SECOND,
    isTimelapseCapturing: false,
    timelapseIntervalMilliseconds: 3000,
    timelapseTimerIdentifier: null,
    autoCaptureCountdownSecondsRemaining: null,
    isCaptureOperationInProgress: false,
    captureReadinessStatus: "capture-ready",
    appSurfaceLayout: {
      width: 0,
      height: 0,
      previewWidth: 0,
      previewHeight: 0,
      controlsWidth: 0,
      timelineHeight: 0,
    },
  };
}

export function adjustPlaybackFramesPerSecond({
  framesPerSecond,
  adjustment,
}) {
  return Math.min(
    MAXIMUM_PLAYBACK_FRAMES_PER_SECOND,
    Math.max(MINIMUM_PLAYBACK_FRAMES_PER_SECOND, framesPerSecond + adjustment),
  );
}

function getSelectionPositionOnTimeline(selectedTimelineItem) {
  return selectedTimelineItem.type === "gap"
    ? selectedTimelineItem.index * 2
    : (selectedTimelineItem.index * 2) + 1;
}

export function ensureTimelineSelectionIsVisible({
  selectedTimelineItem,
  currentTimelineScrollOffsetInItemUnits,
  visibleTimelineItemCount,
  frameCount,
}) {
  const selectedTimelinePosition = getSelectionPositionOnTimeline(selectedTimelineItem);
  const safeVisibleTimelineItemCount = Math.max(1, visibleTimelineItemCount);
  const maximumTimelinePosition = frameCount * 2;
  const maximumTimelineScrollOffset = Math.max(
    0,
    (maximumTimelinePosition + 1) - safeVisibleTimelineItemCount,
  );
  const currentVisibleTimelineStart = Math.max(0, currentTimelineScrollOffsetInItemUnits);
  const currentVisibleTimelineEnd = currentVisibleTimelineStart + safeVisibleTimelineItemCount - 1;

  let nextTimelineScrollOffset = currentVisibleTimelineStart;

  if (selectedTimelinePosition < currentVisibleTimelineStart) {
    nextTimelineScrollOffset = selectedTimelinePosition;
  } else if (selectedTimelinePosition > currentVisibleTimelineEnd) {
    nextTimelineScrollOffset = selectedTimelinePosition - (safeVisibleTimelineItemCount - 1);
  }

  return Math.min(maximumTimelineScrollOffset, Math.max(0, nextTimelineScrollOffset));
}

function createFrameRecord({
  id,
  timelineImageSource,
  previewImageSource,
  playbackImageSource,
  originalStorageKey,
  thumbnailStorageKey,
  width,
  height,
}) {
  return {
    id,
    timelineImageSource,
    previewImageSource,
    playbackImageSource,
    originalStorageKey,
    thumbnailStorageKey,
    width,
    height,
  };
}

export function insertCapturedFrameAtCurrentSelection({
  frames,
  selectedTimelineItem,
  capturedFrameRecordData,
}) {
  const newFrameRecord = createFrameRecord(capturedFrameRecordData);
  const updatedFrames = [...frames];
  let capturedFrameIndex = selectedTimelineItem.index;
  let replacedFrameRecord = null;

  if (selectedTimelineItem.type === "gap") {
    updatedFrames.splice(capturedFrameIndex, 0, newFrameRecord);
  } else {
    replacedFrameRecord = updatedFrames[capturedFrameIndex] || null;
    updatedFrames[capturedFrameIndex] = newFrameRecord;
  }

  return {
    frames: updatedFrames,
    selectedTimelineItem: {
      type: "gap",
      index: capturedFrameIndex + 1,
    },
    replacedFrameRecord,
  };
}

export function deleteSelectedFrame({ frames, selectedTimelineItem }) {
  const selectionIsFrame = selectedTimelineItem.type === "frame";
  const selectionIsGapWithFrameBehindIt = selectedTimelineItem.type === "gap"
    && selectedTimelineItem.index > 0;

  if (!selectionIsFrame && !selectionIsGapWithFrameBehindIt) {
    return {
      frames,
      selectedTimelineItem,
      deletedFrameRecord: null,
    };
  }

  const frameIndexToDelete = selectionIsFrame
    ? selectedTimelineItem.index
    : selectedTimelineItem.index - 1;
  const updatedFrames = [...frames];
  const [deletedFrameRecord] = updatedFrames.splice(frameIndexToDelete, 1);

  return {
    frames: updatedFrames,
    selectedTimelineItem: {
      type: "gap",
      index: frameIndexToDelete,
    },
    deletedFrameRecord,
  };
}

export function canDeleteSelectedFrame(state) {
  if (state.selectedTimelineItem.type === "frame") {
    return true;
  }

  return state.selectedTimelineItem.type === "gap"
    && state.selectedTimelineItem.index > 0;
}

export function canPlayFrames(state) {
  return state.frames.length > 0;
}

export function moveSelectedFrameByOffset({ frames, selectedTimelineItem, movementOffset }) {
  if (selectedTimelineItem.type !== "frame") {
    return {
      frames,
      selectedTimelineItem,
      didMoveFrame: false,
    };
  }

  const currentFrameIndex = selectedTimelineItem.index;
  const nextFrameIndex = currentFrameIndex + movementOffset;

  if (nextFrameIndex < 0 || nextFrameIndex >= frames.length) {
    return {
      frames,
      selectedTimelineItem,
      didMoveFrame: false,
    };
  }

  const reorderedFrames = [...frames];
  const frameRecordBeingMoved = reorderedFrames[currentFrameIndex];
  reorderedFrames[currentFrameIndex] = reorderedFrames[nextFrameIndex];
  reorderedFrames[nextFrameIndex] = frameRecordBeingMoved;

  return {
    frames: reorderedFrames,
    selectedTimelineItem: {
      type: "frame",
      index: nextFrameIndex,
    },
    didMoveFrame: true,
  };
}

function createTimelineSelectionFromPosition(selectionPositionOnTimeline) {
  if (selectionPositionOnTimeline % 2 === 0) {
    return {
      type: "gap",
      index: selectionPositionOnTimeline / 2,
    };
  }

  return {
    type: "frame",
    index: (selectionPositionOnTimeline - 1) / 2,
  };
}

export function moveTimelineSelectionByOffset({ frames, selectedTimelineItem, movementOffset }) {
  const currentSelectionPositionOnTimeline = getSelectionPositionOnTimeline(selectedTimelineItem);
  const maximumSelectionPositionOnTimeline = frames.length * 2;
  const nextSelectionPositionOnTimeline = currentSelectionPositionOnTimeline + movementOffset;

  if (
    nextSelectionPositionOnTimeline < 0
    || nextSelectionPositionOnTimeline > maximumSelectionPositionOnTimeline
  ) {
    return {
      selectedTimelineItem,
      didMoveSelection: false,
    };
  }

  return {
    selectedTimelineItem: createTimelineSelectionFromPosition(nextSelectionPositionOnTimeline),
    didMoveSelection: true,
  };
}
