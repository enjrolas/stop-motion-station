import cameraService from "./services/camera-service.js";
import frameStorageService from "./services/frame-storage-service.js";
import playbackController from "./services/playback-controller.js";
import projectStorageService from "./services/project-storage-service.js";
import computeLayout from "./helpers/compute-layout.js";
import createFrameId from "./helpers/create-frame-id.js";
import {
  createInitialApplicationState,
  insertCapturedFrameAtCurrentSelection,
  deleteSelectedFrame,
  canDeleteSelectedFrame,
  canPlayFrames,
  moveSelectedFrameByOffset,
  moveTimelineSelectionByOffset,
  ensureTimelineSelectionIsVisible,
} from "./helpers/frame-operations.js";
import {
  createProjectBrowserTileList,
  moveProjectBrowserSelectionByDirection,
  findBrowserSelectionIndexForProjectId,
  createDefaultProjectTitle,
  clampSelectionIndex,
} from "./helpers/project-browser-operations.js";
import { computeProjectBrowserColumnCount } from "./views/project-browser.js";

const ENABLE_KEYBOARD_DEBUG_LOGGING = false;
const ENABLE_CAMERA_STARTUP_DEBUG_LOGGING = false;
let hasAttachedGlobalKeyboardListener = false;
const THREE_SECOND_COUNTDOWN_SECONDS = 3;
const automaticCaptureMetronomeSound = new Audio(new URL("./assets/sound/metronome-tick.wav", import.meta.url).href);
const pictureShutterClickSound = new Audio(new URL("./assets/sound/shutter-click.wav", import.meta.url).href);
const projectBrowserModalActionList = [
  "play-project",
  "delete-project",
  "back-to-browser",
];

automaticCaptureMetronomeSound.preload = "auto";
pictureShutterClickSound.preload = "auto";

function playSoundEffect(soundEffectAudioElement) {
  if (!soundEffectAudioElement) {
    return;
  }

  soundEffectAudioElement.currentTime = 0;
  soundEffectAudioElement.play().catch((audioPlaybackError) => {
    console.warn("Could not play sound effect:", audioPlaybackError);
  });
}

function logCameraStartup(...args) {
  if (ENABLE_CAMERA_STARTUP_DEBUG_LOGGING) {
    console.log("[CAMERA_STARTUP]", ...args);
  }
}

async function tryStartCameraPreview({ state, emitter, reason }) {
  if (state.cameraStatus === "starting" || state.cameraStatus === "ready") {
    logCameraStartup("Skipping camera start attempt because camera is already starting or ready", {
      reason,
      cameraStatus: state.cameraStatus,
      timestampMilliseconds: performance.now(),
    });
    return false;
  }

  const attemptStartedAtMilliseconds = performance.now();

  logCameraStartup("Starting camera preview attempt", {
    reason,
    timestampMilliseconds: attemptStartedAtMilliseconds,
    activeElementTagName: document.activeElement?.tagName ?? null,
    visibilityState: document.visibilityState,
  });

  state.cameraStatus = "starting";
  state.cameraErrorMessage = null;
  emitter.emit("render");

  try {
    logCameraStartup("Calling cameraService.startPreview()", {
      reason,
      timestampMilliseconds: performance.now(),
    });

    await cameraService.startPreview();

    state.cameraStatus = "ready";

    logCameraStartup("Camera preview started successfully", {
      reason,
      timestampMilliseconds: performance.now(),
      durationMilliseconds: performance.now() - attemptStartedAtMilliseconds,
    });

    emitter.emit("render");
    return true;
  } catch (cameraStartupError) {
    state.cameraStatus = "idle";
    state.cameraErrorMessage = cameraStartupError.message;

    logCameraStartup("Camera preview failed to start", {
      reason,
      timestampMilliseconds: performance.now(),
      durationMilliseconds: performance.now() - attemptStartedAtMilliseconds,
      errorName: cameraStartupError?.name ?? null,
      errorMessage: cameraStartupError?.message ?? null,
    });

    emitter.emit("render");
    return false;
  }
}

function armNextUserGestureCameraStartup({ state, emitter }) {
  if (state.cameraStatus === "ready" || state.cameraStartupWaitingForUserGesture) {
    logCameraStartup("Not arming user gesture fallback because camera is ready or fallback is already armed", {
      cameraStatus: state.cameraStatus,
      cameraStartupWaitingForUserGesture: state.cameraStartupWaitingForUserGesture,
      timestampMilliseconds: performance.now(),
    });
    return;
  }

  state.cameraStartupWaitingForUserGesture = true;

  logCameraStartup("Arming one-time user gesture fallback for camera startup", {
    timestampMilliseconds: performance.now(),
  });

  emitter.emit("render");

  async function handleUserGesture(userGestureEvent) {
    logCameraStartup("User gesture fallback triggered", {
      eventType: userGestureEvent.type,
      eventKey: userGestureEvent.key ?? null,
      timestampMilliseconds: performance.now(),
    });

    removeUserGestureListeners();
    state.cameraStartupWaitingForUserGesture = false;

    const didStartCamera = await tryStartCameraPreview({
      state,
      emitter,
      reason: `user-gesture:${userGestureEvent.type}`,
    });

    if (!didStartCamera && state.cameraStatus !== "ready") {
      state.cameraStatus = "idle";
      emitter.emit("render");
    }
  }

  function removeUserGestureListeners() {
    document.removeEventListener("pointerdown", handleUserGesture, true);
    document.removeEventListener("click", handleUserGesture, true);
    document.removeEventListener("keydown", handleUserGesture, true);

    logCameraStartup("Removed user gesture fallback listeners", {
      timestampMilliseconds: performance.now(),
    });
  }

  document.addEventListener("pointerdown", handleUserGesture, {
    capture: true,
    once: true,
  });

  document.addEventListener("click", handleUserGesture, {
    capture: true,
    once: true,
  });

  document.addEventListener("keydown", handleUserGesture, {
    capture: true,
    once: true,
  });
}

function scheduleAutomaticCameraStartup({ state, emitter }) {
  logCameraStartup("Scheduling automatic camera startup attempt 1", {
    delayMilliseconds: 300,
    timestampMilliseconds: performance.now(),
  });

  window.setTimeout(async () => {
    logCameraStartup("Automatic camera startup attempt 1 timer fired", {
      timestampMilliseconds: performance.now(),
    });

    const didStartOnFirstAttempt = await tryStartCameraPreview({
      state,
      emitter,
      reason: "automatic-startup-attempt-1",
    });

    if (didStartOnFirstAttempt) {
      return;
    }

    logCameraStartup("Scheduling automatic camera startup attempt 2", {
      delayMilliseconds: 900,
      timestampMilliseconds: performance.now(),
    });

    window.setTimeout(async () => {
      logCameraStartup("Automatic camera startup attempt 2 timer fired", {
        timestampMilliseconds: performance.now(),
      });

      const didStartOnSecondAttempt = await tryStartCameraPreview({
        state,
        emitter,
        reason: "automatic-startup-attempt-2",
      });

      if (didStartOnSecondAttempt) {
        return;
      }

      armNextUserGestureCameraStartup({
        state,
        emitter,
      });
    }, 900);
  }, 300);
}

function attachGlobalKeyboardListener(state, emitter) {
  if (hasAttachedGlobalKeyboardListener) {
    return;
  }

  hasAttachedGlobalKeyboardListener = true;
  const currentlyPressedKeys = new Set();
  let automaticCaptureShortcutWasPressed = false;

  function log(...args) {
    if (ENABLE_KEYBOARD_DEBUG_LOGGING) {
      console.log("[KEYBOARD]", ...args);
    }
  }

  function normalizeKeyboardInput(event) {
    const key = event.key;
    const code = event.code;
    const isSpace =
      code === "Space"
      || key === " "
      || key === "Spacebar"
      || key === "Space";

    return {
      key,
      code,
      isSpace,
      isArrowUp: key === "ArrowUp",
    };
  }

  function updateAutomaticCaptureShortcutState() {
    const isHoldingPlayAndRecordShortcut = currentlyPressedKeys.has("ArrowUp")
      && currentlyPressedKeys.has("Space");

    if (state.appMode !== "project-editor") {
      return;
    }

    if (isHoldingPlayAndRecordShortcut) {
      automaticCaptureShortcutWasPressed = true;
    }
  }

  function handleKeyboardShortcuts(event) {
    const normalizedKeyboardInput = normalizeKeyboardInput(event);
    const { key, code, isSpace, isArrowUp } = normalizedKeyboardInput;

    if (isSpace) {
      currentlyPressedKeys.add("Space");
    } else {
      currentlyPressedKeys.add(key);
    }

    log("keydown event received", {
      key,
      code,
      repeat: event.repeat,
      activeElement: document.activeElement?.tagName,
      appMode: state.appMode,
    });

    const isHoldingPlayAndRecordShortcut = currentlyPressedKeys.has("ArrowUp")
      && currentlyPressedKeys.has("Space");

    if (isHoldingPlayAndRecordShortcut && state.appMode === "project-editor") {
      event.preventDefault();
      updateAutomaticCaptureShortcutState();
      return;
    }

    if (state.appMode === "project-editor" && state.isTimelapseCapturing) {
      log("ACTION: stop auto-capture because another key was pressed");
      emitter.emit("timelapse:stop");
    }

    if (state.appMode === "project-browser") {
      const shouldCloseProjectBrowserModal = key === "Escape" || key === "w" || key === "W";

      if (shouldCloseProjectBrowserModal && state.projectBrowserModalProjectId) {
        event.preventDefault();
        emitter.emit("project-browser:close-project-modal");
        return;
      }

      if (state.projectBrowserModalProjectId) {
        if (key === "ArrowLeft" || key === "ArrowUp") {
          event.preventDefault();
          emitter.emit("project-browser:move-modal-selection-previous");
          return;
        }

        if (key === "ArrowRight" || key === "ArrowDown") {
          event.preventDefault();
          emitter.emit("project-browser:move-modal-selection-next");
          return;
        }

        if (isSpace) {
          event.preventDefault();
          emitter.emit("project-browser:activate-selected-modal-action");
          return;
        }

        log("UNHANDLED PROJECT BROWSER MODAL KEY", key);
        return;
      }

      if (key === "ArrowLeft") {
        event.preventDefault();
        emitter.emit("project-browser:move-selection-left");
        return;
      }

      if (key === "ArrowRight") {
        event.preventDefault();
        emitter.emit("project-browser:move-selection-right");
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        emitter.emit("project-browser:move-selection-up");
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        emitter.emit("project-browser:move-selection-down");
        return;
      }

      if (isSpace) {
        event.preventDefault();
        emitter.emit("project-browser:activate-selected-tile");
        return;
      }

      log("UNHANDLED PROJECT BROWSER KEY", key);
      return;
    }

    const shouldReturnToProjectBrowser = key === "Escape" || key === "w" || key === "W";

    if (shouldReturnToProjectBrowser) {
      event.preventDefault();
      emitter.emit("project-editor:return-to-browser");
      return;
    }

    if (isSpace) {
      log("ACTION: capture frame");
      event.preventDefault();
      emitter.emit("frames:capture");
      return;
    }

    if (key === "ArrowLeft") {
      event.preventDefault();

      if (event.shiftKey) {
        log("ACTION: move selected frame left");
        emitter.emit("timeline:move-selected-frame-left");
        return;
      }

      log("ACTION: move selection left");
      emitter.emit("timeline:move-selection-left");
      return;
    }

    if (key === "ArrowRight") {
      event.preventDefault();

      if (event.shiftKey) {
        log("ACTION: move selected frame right");
        emitter.emit("timeline:move-selected-frame-right");
        return;
      }

      log("ACTION: move selection right");
      emitter.emit("timeline:move-selection-right");
      return;
    }

    if (isArrowUp) {
      log("ACTION: play");
      event.preventDefault();
      emitter.emit("playback:start");
      return;
    }

    const shouldDeleteSelectedFrame =
      key === "ArrowDown" ||
      key === "Backspace" ||
      key === "Delete";

    if (shouldDeleteSelectedFrame) {
      log("ACTION: delete");
      event.preventDefault();
      emitter.emit("frames:delete-selected");
      return;
    }

    log("UNHANDLED KEY", key);
  }

  function handleKeyboardShortcutRelease(event) {
    const normalizedKeyboardInput = normalizeKeyboardInput(event);
    const { key, isSpace, isArrowUp } = normalizedKeyboardInput;

    if (isSpace) {
      currentlyPressedKeys.delete("Space");
    } else {
      currentlyPressedKeys.delete(key);
    }

    if (state.appMode !== "project-editor") {
      return;
    }

    if (isSpace || isArrowUp) {
      updateAutomaticCaptureShortcutState();
    }

    const automaticCaptureShortcutIsFullyReleased = !currentlyPressedKeys.has("ArrowUp")
      && !currentlyPressedKeys.has("Space");

    if (
      automaticCaptureShortcutWasPressed
      && automaticCaptureShortcutIsFullyReleased
      && !state.isTimelapseCapturing
    ) {
      log("ACTION: toggle auto-capture on after shortcut press-and-release");
      automaticCaptureShortcutWasPressed = false;
      emitter.emit("timelapse:start");
      return;
    }

    if (automaticCaptureShortcutIsFullyReleased) {
      automaticCaptureShortcutWasPressed = false;
    }
  }

  log("Attaching keyboard listeners");

  // Attach to document only once to avoid duplicate key handling.
  document.addEventListener("keydown", handleKeyboardShortcuts, {
    passive: false,
    capture: true,
  });
  document.addEventListener("keyup", handleKeyboardShortcutRelease, {
    passive: true,
    capture: true,
  });

  // Focus logging
  document.addEventListener("focusin", () => {
    log("focusin", document.activeElement);
  });

  document.addEventListener("focusout", () => {
    log("focusout", document.activeElement);
  });

  // Continuous focus visibility
  setInterval(() => {
    log("activeElement snapshot", document.activeElement);
  }, 2000);

  // Ensure body is focusable and focused
  document.body.tabIndex = 0;
  document.body.focus();

  // Re-focus on click (important on Pi)
  document.addEventListener("click", () => {
    log("click → forcing focus back to body");
    document.body.focus();
  });
}

export default function applicationStore(state, emitter) {
  Object.assign(state, createInitialApplicationState());
  attachGlobalKeyboardListener(state, emitter);

  let animationFrameIdentifierForTimelineScroll = null;
  let automaticCaptureTimeoutIdentifier = null;
  let automaticCaptureSessionIdentifier = 0;
  let pendingLayoutRefreshAnimationFrameIdentifier = null;

  function resolveViewportDimensionsForLayout() {
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement) {
      const fullscreenElementBounds = fullscreenElement.getBoundingClientRect();
      if (fullscreenElementBounds.width > 0 && fullscreenElementBounds.height > 0) {
        return {
          viewportWidth: fullscreenElementBounds.width,
          viewportHeight: fullscreenElementBounds.height,
        };
      }
    }

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  function updateApplicationLayoutFromViewport() {
    const { viewportWidth, viewportHeight } = resolveViewportDimensionsForLayout();

    state.appSurfaceLayout = computeLayout({
      viewportWidth,
      viewportHeight,
    });

    state.projectBrowserColumnCount = computeProjectBrowserColumnCount({
      availableWidth: viewportWidth,
    });
  }

  async function reloadProjectsFromStorage() {
    state.projects = await projectStorageService.listProjects();

    const projectBrowserTileList = createProjectBrowserTileList({
      projects: state.projects,
    });

    state.selectedProjectBrowserIndex = clampSelectionIndex({
      selectedIndex: state.selectedProjectBrowserIndex,
      tileCount: projectBrowserTileList.length,
    });
  }

  async function persistCurrentProjectState() {
    if (!state.currentProjectId) {
      return;
    }

    const updatedProjectMetadata = await projectStorageService.saveProject({
      projectId: state.currentProjectId,
      frames: state.frames,
      title: state.currentProjectTitle,
    });

    state.currentProjectTitle = updatedProjectMetadata.title;
    await reloadProjectsFromStorage();
  }

  async function openProjectInEditorById({ projectId }) {
    const loadedProject = await projectStorageService.loadProject({ projectId });

    state.currentProjectId = loadedProject.id;
    state.currentProjectTitle = loadedProject.title;
    state.frames = loadedProject.frames;
    state.selectedTimelineItem = {
      type: "gap",
      index: state.frames.length,
    };
    state.timelineScrollOffsetInItemUnits = 0;
    state.timelineScrollTargetOffsetInItemUnits = 0;
    updateTimelineScrollTargetAndClampCurrentOffset();
    state.appMode = "project-editor";

    if (state.cameraStatus === "idle") {
      scheduleAutomaticCameraStartup({ state, emitter });
    }
  }

  async function createProjectAndOpenInEditor() {
    const projectTitle = createDefaultProjectTitle({
      projects: state.projects,
    });

    const createdProjectResult = await projectStorageService.createProject({
      title: projectTitle,
    });

    await reloadProjectsFromStorage();

    state.selectedProjectBrowserIndex = findBrowserSelectionIndexForProjectId({
      projects: state.projects,
      projectId: createdProjectResult.projectMetadata.id,
    });

    await openProjectInEditorById({
      projectId: createdProjectResult.projectMetadata.id,
    });
  }

  function moveProjectBrowserSelection(direction) {
    const projectBrowserTileList = createProjectBrowserTileList({
      projects: state.projects,
    });

    state.selectedProjectBrowserIndex = moveProjectBrowserSelectionByDirection({
      selectedIndex: state.selectedProjectBrowserIndex,
      tileCount: projectBrowserTileList.length,
      columnCount: state.projectBrowserColumnCount,
      direction,
    });

    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
  }

  function moveProjectBrowserModalSelectionByOffset(actionOffset) {
    const modalActionCount = projectBrowserModalActionList.length;

    if (modalActionCount < 1) {
      state.projectBrowserModalSelectedActionIndex = 0;
      return;
    }

    const currentSelectedActionIndex = state.projectBrowserModalSelectedActionIndex ?? 0;
    const normalizedSelectedActionIndex = ((currentSelectedActionIndex + actionOffset) % modalActionCount
      + modalActionCount) % modalActionCount;

    state.projectBrowserModalSelectedActionIndex = normalizedSelectedActionIndex;
  }

  async function activateSelectedProjectBrowserTile() {
    const projectBrowserTileList = createProjectBrowserTileList({
      projects: state.projects,
    });
    const selectedTile = projectBrowserTileList[state.selectedProjectBrowserIndex];

    if (!selectedTile) {
      return;
    }

    if (selectedTile.type === "new-project") {
      await createProjectAndOpenInEditor();
      return;
    }

    state.projectBrowserModalProjectId = selectedTile.projectId;
    state.projectBrowserModalSelectedActionIndex = 0;
  }

  function getProjectMetadataForProjectBrowserModal() {
    if (!state.projectBrowserModalProjectId) {
      return null;
    }

    return state.projects.find(
      (projectMetadata) => projectMetadata.id === state.projectBrowserModalProjectId,
    ) ?? null;
  }

  async function openProjectBrowserModalProjectInEditor() {
    const selectedProjectMetadata = getProjectMetadataForProjectBrowserModal();

    if (!selectedProjectMetadata) {
      state.projectBrowserModalProjectId = null;
      state.projectBrowserModalSelectedActionIndex = 0;
      return;
    }

    state.selectedProjectBrowserIndex = findBrowserSelectionIndexForProjectId({
      projects: state.projects,
      projectId: selectedProjectMetadata.id,
    });
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;

    await openProjectInEditorById({
      projectId: selectedProjectMetadata.id,
    });
  }

  async function deleteProjectInProjectBrowserModal() {
    const selectedProjectMetadata = getProjectMetadataForProjectBrowserModal();

    if (!selectedProjectMetadata) {
      state.projectBrowserModalProjectId = null;
      state.projectBrowserModalSelectedActionIndex = 0;
      return;
    }

    const projectToDelete = await projectStorageService.loadProject({
      projectId: selectedProjectMetadata.id,
    });

    for (const frameRecord of projectToDelete.frames) {
      if (frameRecord?.originalStorageKey) {
        try {
          await frameStorageService.deleteOriginalFrame({
            storageKey: frameRecord.originalStorageKey,
          });
        } catch (originalFrameDeleteError) {
          console.warn("Could not delete a project frame original asset:", originalFrameDeleteError);
        }
      }
    }

    await projectStorageService.deleteProject({
      projectId: selectedProjectMetadata.id,
    });
    await reloadProjectsFromStorage();
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    state.selectedProjectBrowserIndex = clampSelectionIndex({
      selectedIndex: state.selectedProjectBrowserIndex,
      tileCount: createProjectBrowserTileList({ projects: state.projects }).length,
    });
  }

  async function captureAndInsertFrameRecord() {
    if (state.isCaptureOperationInProgress) {
      return false;
    }

    state.isCaptureOperationInProgress = true;
    updateCaptureReadinessFromCurrentState();
    emitter.emit("render");

    const frameIdentifier = createFrameId();
    const captureFlowStartedAtMilliseconds = performance.now();

    playSoundEffect(pictureShutterClickSound);

    try {
      const capturedFrameData = await measureAsyncOperationDuration({
        operationName: "camera-frame-capture",
        frameIdentifier,
        operation: () => cameraService.captureFrameRecordData(),
      });

      const originalFrameSaveResult = await measureAsyncOperationDuration({
        operationName: "original-frame-save",
        frameIdentifier,
        operation: () => frameStorageService.saveOriginalFrameBlob({
          frameId: frameIdentifier,
          blob: capturedFrameData.originalBlob,
        }),
      });

      const totalCaptureFlowDurationMilliseconds = performance.now()
        - captureFlowStartedAtMilliseconds;

      console.info("Frame capture flow timing", {
        frameIdentifier,
        captureDurationMilliseconds: capturedFrameData.captureDurationMilliseconds,
        originalFrameSaveDurationMilliseconds: originalFrameSaveResult.captureDurationMilliseconds,
        totalCaptureFlowDurationMilliseconds,
        originalBlobSizeInBytes: capturedFrameData.originalBlobSizeInBytes,
        timelineBlobSizeInBytes: capturedFrameData.timelineBlobSizeInBytes,
      });

      const capturedFrameRecordData = {
        id: frameIdentifier,
        timelineImageSource: capturedFrameData.timelineImageSource,
        previewImageSource: capturedFrameData.previewImageSource,
        originalStorageKey: originalFrameSaveResult.operationResult,
        width: capturedFrameData.width,
        height: capturedFrameData.height,
      };

      const insertionResult = insertCapturedFrameAtCurrentSelection({
        frames: state.frames,
        selectedTimelineItem: state.selectedTimelineItem,
        capturedFrameRecordData,
      });

      state.frames = insertionResult.frames;
      state.selectedTimelineItem = insertionResult.selectedTimelineItem;
      updateTimelineScrollTargetAndClampCurrentOffset();
      animateTimelineScrollOffsetTowardsTargetIfNeeded();

      if (insertionResult.replacedFrameRecord) {
        try {
          await cleanupDeletedFrameAssets(insertionResult.replacedFrameRecord);
        } catch (replaceCleanupError) {
          console.error("Failed to clean up replaced frame assets:", replaceCleanupError);
        }
      }

      await persistCurrentProjectState();
      return true;
    } finally {
      state.isCaptureOperationInProgress = false;
      updateCaptureReadinessFromCurrentState();
      emitter.emit("render");
    }
  }

  async function measureAsyncOperationDuration({ operationName, frameIdentifier, operation }) {
    const operationStartedAtMilliseconds = performance.now();
    const operationResult = await operation();
    const captureDurationMilliseconds = performance.now() - operationStartedAtMilliseconds;

    console.info("Frame operation timing", {
      frameIdentifier,
      operationName,
      captureDurationMilliseconds,
    });

    return {
      operationResult,
      captureDurationMilliseconds,
      ...(typeof operationResult === "object" && operationResult !== null
        ? operationResult
        : {}),
    };
  }

  async function cleanupDeletedFrameAssets(deletedFrameRecord) {
    if (!deletedFrameRecord) {
      return;
    }

    if (deletedFrameRecord.timelineImageSource?.startsWith("blob:")) {
      URL.revokeObjectURL(deletedFrameRecord.timelineImageSource);
    }

    if (
      deletedFrameRecord.previewImageSource
      && deletedFrameRecord.previewImageSource !== deletedFrameRecord.timelineImageSource
      && deletedFrameRecord.previewImageSource.startsWith("blob:")
    ) {
      URL.revokeObjectURL(deletedFrameRecord.previewImageSource);
    }

    await frameStorageService.deleteOriginalFrame({
      storageKey: deletedFrameRecord.originalStorageKey,
    });
  }

  function stopTimelapseCaptureInterval() {
    if (state.timelapseTimerIdentifier !== null) {
      window.clearInterval(state.timelapseTimerIdentifier);
      state.timelapseTimerIdentifier = null;
    }

    if (automaticCaptureTimeoutIdentifier !== null) {
      window.clearTimeout(automaticCaptureTimeoutIdentifier);
      automaticCaptureTimeoutIdentifier = null;
    }

    state.autoCaptureCountdownSecondsRemaining = null;
  }

  function waitForMillisecondsBeforeNextAutomaticCapture(millisecondsToWait) {
    return new Promise((resolve) => {
      automaticCaptureTimeoutIdentifier = window.setTimeout(() => {
        automaticCaptureTimeoutIdentifier = null;
        resolve();
      }, millisecondsToWait);
    });
  }

  function isAutomaticCaptureSessionActive(automaticCaptureSessionId) {
    return state.isTimelapseCapturing && automaticCaptureSessionId === automaticCaptureSessionIdentifier;
  }

  async function runAutomaticCaptureCycleForSession(automaticCaptureSessionId) {
    if (!isAutomaticCaptureSessionActive(automaticCaptureSessionId)) {
      return;
    }

    while (isAutomaticCaptureSessionActive(automaticCaptureSessionId)) {
      for (
        let secondsRemainingInCountdown = THREE_SECOND_COUNTDOWN_SECONDS;
        secondsRemainingInCountdown >= 1;
        secondsRemainingInCountdown -= 1
      ) {
        if (!isAutomaticCaptureSessionActive(automaticCaptureSessionId)) {
          return;
        }

        state.autoCaptureCountdownSecondsRemaining = secondsRemainingInCountdown;
        playSoundEffect(automaticCaptureMetronomeSound);
        emitter.emit("render");
        await waitForMillisecondsBeforeNextAutomaticCapture(1000);
      }

      if (!isAutomaticCaptureSessionActive(automaticCaptureSessionId)) {
        return;
      }

      try {
        await captureAndInsertFrameRecord();
      } catch (captureError) {
        console.error("Failed to capture timelapse frame:", captureError);
      }
    }
  }

  function updateCaptureReadinessFromCurrentState() {
    state.captureReadinessStatus = state.isCaptureOperationInProgress ? "busy" : "capture-ready";
  }

  function getTimelineItemToKeepVisible() {
    if (state.isPlaying && state.playbackFrameIndex !== null) {
      return {
        type: "frame",
        index: state.playbackFrameIndex,
      };
    }

    return state.selectedTimelineItem;
  }

  function updateVisibleTimelineScrollTargetFromFocusedTimelineItem() {
    state.timelineScrollTargetOffsetInItemUnits = ensureTimelineSelectionIsVisible({
      selectedTimelineItem: getTimelineItemToKeepVisible(),
      currentTimelineScrollOffsetInItemUnits: state.timelineScrollTargetOffsetInItemUnits,
      visibleTimelineItemCount: state.visibleTimelineItemCount,
      frameCount: state.frames.length,
    });
  }

  function updateTimelineScrollTargetAndClampCurrentOffset() {
    updateVisibleTimelineScrollTargetFromFocusedTimelineItem();

    const maximumTimelinePosition = state.frames.length * 2;
    const maximumTimelineScrollOffset = Math.max(
      0,
      (maximumTimelinePosition + 1) - Math.max(1, state.visibleTimelineItemCount),
    );
    state.timelineScrollOffsetInItemUnits = Math.min(
      maximumTimelineScrollOffset,
      Math.max(0, state.timelineScrollOffsetInItemUnits),
    );
  }

  function animateTimelineScrollOffsetTowardsTargetIfNeeded() {
    if (animationFrameIdentifierForTimelineScroll !== null) {
      return;
    }

    const animateScrollStep = () => {
      animationFrameIdentifierForTimelineScroll = null;
      const timelineScrollDeltaInItemUnits =
        state.timelineScrollTargetOffsetInItemUnits - state.timelineScrollOffsetInItemUnits;

      if (Math.abs(timelineScrollDeltaInItemUnits) < 0.001) {
        state.timelineScrollOffsetInItemUnits = state.timelineScrollTargetOffsetInItemUnits;
        emitter.emit("render");
        return;
      }

      state.timelineScrollOffsetInItemUnits += timelineScrollDeltaInItemUnits * 0.2;
      emitter.emit("render");
      animationFrameIdentifierForTimelineScroll = window.requestAnimationFrame(animateScrollStep);
    };

    animationFrameIdentifierForTimelineScroll = window.requestAnimationFrame(animateScrollStep);
  }

  function focusApplicationRootForKeyboardInput() {
    const applicationRootElement = document.body;
    if (!applicationRootElement) {
      return;
    }

    if (applicationRootElement.tabIndex !== 0) {
      applicationRootElement.tabIndex = 0;
    }

    if (document.activeElement !== applicationRootElement) {
      applicationRootElement.focus();
    }
  }

  updateApplicationLayoutFromViewport();

  emitter.on("application:startup", async () => {
    const handleViewportChange = () => {
      emitter.emit("application:resize");
    };

    const scheduleDelayedLayoutRefresh = () => {
      if (pendingLayoutRefreshAnimationFrameIdentifier !== null) {
        window.cancelAnimationFrame(pendingLayoutRefreshAnimationFrameIdentifier);
      }

      pendingLayoutRefreshAnimationFrameIdentifier = window.requestAnimationFrame(() => {
        pendingLayoutRefreshAnimationFrameIdentifier = window.requestAnimationFrame(() => {
          pendingLayoutRefreshAnimationFrameIdentifier = null;
          emitter.emit("application:resize");
        });
      });
    };

    window.addEventListener("load", focusApplicationRootForKeyboardInput);
    window.addEventListener("click", focusApplicationRootForKeyboardInput);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    document.addEventListener("fullscreenchange", () => {
      handleViewportChange();
      scheduleDelayedLayoutRefresh();
    });
    window.setInterval(focusApplicationRootForKeyboardInput, 1000);
    focusApplicationRootForKeyboardInput();

    await frameStorageService.initialize();
    await projectStorageService.initialize();
    await reloadProjectsFromStorage();
    state.selectedProjectBrowserIndex = 0;
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    state.appMode = "project-browser";
    emitter.emit("render");
  });

  emitter.on("camera:request-access", async () => {
    if (state.isTimelapseCapturing) {
      return;
    }

    const didStartCamera = await tryStartCameraPreview({
      state,
      emitter,
      reason: "manual-request",
    });

    if (!didStartCamera && state.cameraStatus !== "ready") {
      state.cameraStatus = "error";
      emitter.emit("render");
    }
  });

  emitter.on("application:resize", () => {
    updateApplicationLayoutFromViewport();
    emitter.emit("render");
  });

  emitter.on("project-browser:move-selection-left", () => {
    if (state.appMode !== "project-browser" || state.projectBrowserModalProjectId) {
      return;
    }

    moveProjectBrowserSelection("left");
    emitter.emit("render");
  });

  emitter.on("project-browser:move-selection-right", () => {
    if (state.appMode !== "project-browser" || state.projectBrowserModalProjectId) {
      return;
    }

    moveProjectBrowserSelection("right");
    emitter.emit("render");
  });

  emitter.on("project-browser:move-selection-up", () => {
    if (state.appMode !== "project-browser" || state.projectBrowserModalProjectId) {
      return;
    }

    moveProjectBrowserSelection("up");
    emitter.emit("render");
  });

  emitter.on("project-browser:move-selection-down", () => {
    if (state.appMode !== "project-browser" || state.projectBrowserModalProjectId) {
      return;
    }

    moveProjectBrowserSelection("down");
    emitter.emit("render");
  });

  emitter.on("project-browser:activate-selected-tile", async () => {
    if (state.appMode !== "project-browser" || state.projectBrowserModalProjectId) {
      return;
    }

    await activateSelectedProjectBrowserTile();
    emitter.emit("render");
  });

  emitter.on("project-browser:select-tile", (tileIndex) => {
    if (state.appMode !== "project-browser" || state.projectBrowserModalProjectId) {
      return;
    }

    const projectBrowserTileList = createProjectBrowserTileList({
      projects: state.projects,
    });

    state.selectedProjectBrowserIndex = clampSelectionIndex({
      selectedIndex: tileIndex,
      tileCount: projectBrowserTileList.length,
    });
    emitter.emit("render");
  });

  emitter.on("project-browser:close-project-modal", () => {
    if (state.appMode !== "project-browser") {
      return;
    }

    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    emitter.emit("render");
  });

  emitter.on("project-browser:move-modal-selection-previous", () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    moveProjectBrowserModalSelectionByOffset(-1);
    emitter.emit("render");
  });

  emitter.on("project-browser:move-modal-selection-next", () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    moveProjectBrowserModalSelectionByOffset(1);
    emitter.emit("render");
  });

  emitter.on("project-browser:activate-selected-modal-action", async () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    const selectedModalActionKey = projectBrowserModalActionList[state.projectBrowserModalSelectedActionIndex];

    if (selectedModalActionKey === "play-project") {
      await openProjectBrowserModalProjectInEditor();
      emitter.emit("render");
      return;
    }

    if (selectedModalActionKey === "delete-project") {
      await deleteProjectInProjectBrowserModal();
      emitter.emit("render");
      return;
    }

    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    emitter.emit("render");
  });

  emitter.on("project-browser:play-modal-project", async () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    await openProjectBrowserModalProjectInEditor();
    emitter.emit("render");
  });

  emitter.on("project-browser:delete-modal-project", async () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    await deleteProjectInProjectBrowserModal();
    emitter.emit("render");
  });

  emitter.on("project-editor:return-to-browser", async () => {
    if (state.appMode !== "project-editor") {
      return;
    }

    await persistCurrentProjectState();
    await reloadProjectsFromStorage();
    state.selectedProjectBrowserIndex = findBrowserSelectionIndexForProjectId({
      projects: state.projects,
      projectId: state.currentProjectId,
    });
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    state.appMode = "project-browser";
    emitter.emit("render");
  });

  emitter.on("timeline:select-gap", (gapIndex) => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing) {
      return;
    }

    state.selectedTimelineItem = { type: "gap", index: gapIndex };
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    emitter.emit("render");
  });

  emitter.on("timeline:select-frame", (frameIndex) => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing) {
      return;
    }

    state.selectedTimelineItem = { type: "frame", index: frameIndex };
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    emitter.emit("render");
  });

  emitter.on("timeline:move-selected-frame-left", async () => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing) {
      return;
    }

    const movementResult = moveSelectedFrameByOffset({
      frames: state.frames,
      selectedTimelineItem: state.selectedTimelineItem,
      movementOffset: -1,
    });

    if (!movementResult.didMoveFrame) {
      return;
    }

    state.frames = movementResult.frames;
    state.selectedTimelineItem = movementResult.selectedTimelineItem;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    await persistCurrentProjectState();
    emitter.emit("render");
  });

  emitter.on("timeline:move-selected-frame-right", async () => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing) {
      return;
    }

    const movementResult = moveSelectedFrameByOffset({
      frames: state.frames,
      selectedTimelineItem: state.selectedTimelineItem,
      movementOffset: 1,
    });

    if (!movementResult.didMoveFrame) {
      return;
    }

    state.frames = movementResult.frames;
    state.selectedTimelineItem = movementResult.selectedTimelineItem;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    await persistCurrentProjectState();
    emitter.emit("render");
  });

  emitter.on("timeline:move-selection-left", () => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing) {
      return;
    }

    const movementResult = moveTimelineSelectionByOffset({
      frames: state.frames,
      selectedTimelineItem: state.selectedTimelineItem,
      movementOffset: -1,
    });

    if (!movementResult.didMoveSelection) {
      return;
    }

    state.selectedTimelineItem = movementResult.selectedTimelineItem;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    emitter.emit("render");
  });

  emitter.on("timeline:move-selection-right", () => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing) {
      return;
    }

    const movementResult = moveTimelineSelectionByOffset({
      frames: state.frames,
      selectedTimelineItem: state.selectedTimelineItem,
      movementOffset: 1,
    });

    if (!movementResult.didMoveSelection) {
      return;
    }

    state.selectedTimelineItem = movementResult.selectedTimelineItem;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    emitter.emit("render");
  });

  emitter.on("frames:capture", async () => {
    if (
      state.appMode !== "project-editor"
      || state.cameraStatus !== "ready"
      || state.isPlaying
      || state.isTimelapseCapturing
      || state.isCaptureOperationInProgress
    ) {
      return;
    }

    try {
      await captureAndInsertFrameRecord();
    } catch (captureError) {
      console.error("Failed to capture frame:", captureError);
    }

    emitter.emit("render");
  });

  emitter.on("timelapse:start", () => {
    if (
      state.appMode !== "project-editor"
      || state.isTimelapseCapturing
      || state.cameraStatus !== "ready"
      || state.isPlaying
      || state.isCaptureOperationInProgress
    ) {
      return;
    }

    state.isTimelapseCapturing = true;
    automaticCaptureSessionIdentifier += 1;
    state.autoCaptureCountdownSecondsRemaining = null;
    runAutomaticCaptureCycleForSession(automaticCaptureSessionIdentifier);

    emitter.emit("render");
  });

  emitter.on("timelapse:stop", () => {
    if (!state.isTimelapseCapturing) {
      return;
    }

    stopTimelapseCaptureInterval();
    state.isTimelapseCapturing = false;
    automaticCaptureSessionIdentifier += 1;
    emitter.emit("render");
  });

  emitter.on("frames:delete-selected", async () => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing || !canDeleteSelectedFrame(state)) {
      return;
    }

    const deletionResult = deleteSelectedFrame({
      frames: state.frames,
      selectedTimelineItem: state.selectedTimelineItem,
    });

    state.frames = deletionResult.frames;
    state.selectedTimelineItem = deletionResult.selectedTimelineItem;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();

    try {
      await cleanupDeletedFrameAssets(deletionResult.deletedFrameRecord);
    } catch (deleteError) {
      console.error("Failed to clean up deleted frame assets:", deleteError);
    }

    await persistCurrentProjectState();
    emitter.emit("render");
  });

  emitter.on("playback:start", () => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing || !canPlayFrames(state)) {
      return;
    }

    state.isPlaying = true;
    state.playbackFrameIndex = 0;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    emitter.emit("render");

    playbackController.playFrames({
      frames: state.frames,
      framesPerSecond: 8,
      onFrameChange(frameIndex) {
        state.playbackFrameIndex = frameIndex;
        updateTimelineScrollTargetAndClampCurrentOffset();
        animateTimelineScrollOffsetTowardsTargetIfNeeded();
        emitter.emit("render");
      },
      onComplete() {
        state.isPlaying = false;
        state.playbackFrameIndex = null;
        updateTimelineScrollTargetAndClampCurrentOffset();
        animateTimelineScrollOffsetTowardsTargetIfNeeded();
        emitter.emit("render");
      },
    });
  });

  emitter.on("playback:stop", () => {
    playbackController.stop();
    state.isPlaying = false;
    state.playbackFrameIndex = null;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
    emitter.emit("render");
  });
}
