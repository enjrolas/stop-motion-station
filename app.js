import cameraService from "./services/camera-service.js";
import capturePersistenceService from "./services/capture-persistence-service.js";
import frameStorageService, {
  createOriginalFrameStorageKey,
  createThumbnailFrameStorageKey,
} from "./services/frame-storage-service.js";
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
  adjustPlaybackFramesPerSecond,
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
import {
  PROJECT_TITLE_KEYBOARD_KEYS,
  PROJECT_TITLE_MAXIMUM_LENGTH,
  applyProjectTitleKeyboardKey,
  createInactiveProjectTitleEditorState,
  createProjectTitleEditorState,
  moveProjectTitleKeyboardSelection,
} from "./helpers/project-title-keyboard.js";
import {
  GAMEPAD_ACTIONS,
  getGamepadActionForButton,
  isGamepadButtonPressed,
  isMappedGamepadButton,
} from "./helpers/gamepad-controls.js";
import { computeProjectBrowserColumnCount } from "./views/project-browser.js";
import { computeVisibleTimelineItemCount } from "./views/timeline-panel.js";

const ENABLE_KEYBOARD_DEBUG_LOGGING = false;
const ENABLE_GAMEPAD_DEBUG_LOGGING = false;
const ENABLE_CAMERA_STARTUP_DEBUG_LOGGING = false;
let hasAttachedGlobalKeyboardListener = false;
let hasAttachedGamepadListener = false;
const THREE_SECOND_COUNTDOWN_SECONDS = 3;
const BACKGROUND_PROJECT_PERSISTENCE_DELAY_MILLISECONDS = 400;
const automaticCaptureMetronomeSound = new Audio(new URL("./assets/sound/metronome-tick.wav", import.meta.url).href);
const pictureShutterClickSound = new Audio(new URL("./assets/sound/shutter-click.wav", import.meta.url).href);
const projectBrowserModalActionList = [
  "play-project",
  "edit-project",
  "edit-title",
  "record-sound",
  "export-video",
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

function createShortcutControllerState() {
  return {
    automaticCaptureShortcutWasPressed: false,
    playShortcutWasPressed: false,
    playbackSpeedShortcutWasUsed: false,
    currentlyPressedKeys: new Set(),
  };
}

function normalizeShortcutInput({
  key,
  code = "",
  shiftKey = false,
  ctrlKey = false,
  altKey = false,
  metaKey = false,
}) {
  const isSpace =
    code === "Space"
    || key === " "
    || key === "Spacebar"
    || key === "Space";

  return {
    key,
    code,
    shiftKey,
    ctrlKey,
    altKey,
    metaKey,
    pressedKey: isSpace ? "Space" : key,
    isSpace,
    isArrowUp: key === "ArrowUp",
    isEnter: key === "Enter",
    isBackOrEscape: key === "Escape" || key === "w" || key === "W",
    isDelete: key === "ArrowDown" || key === "Backspace" || key === "Delete",
  };
}

function isPrintableProjectTitleShortcut(shortcut) {
  return (
    typeof shortcut.key === "string"
    && shortcut.key.length === 1
    && !shortcut.ctrlKey
    && !shortcut.altKey
    && !shortcut.metaKey
  );
}

function updateAutomaticCaptureShortcutState({ state, controllerState }) {
  const isHoldingPlayAndRecordShortcut = controllerState.currentlyPressedKeys.has("ArrowUp")
    && controllerState.currentlyPressedKeys.has("Space");

  if (state.appMode !== "project-editor") {
    return;
  }

  if (isHoldingPlayAndRecordShortcut) {
    controllerState.automaticCaptureShortcutWasPressed = true;
  }
}

function adjustPlaybackSpeedFromShortcut({ state, emitter, controllerState, adjustment, log }) {
  if (state.appMode !== "project-editor") {
    return false;
  }

  controllerState.playbackSpeedShortcutWasUsed = true;
  log("ACTION: adjust playback speed", { adjustment });
  emitter.emit("playback:adjust-speed", adjustment);
  return true;
}

function handleShortcutPress({ state, emitter, controllerState, shortcut, log }) {
  controllerState.currentlyPressedKeys.add(shortcut.pressedKey);

  log("shortcut press", {
    key: shortcut.key,
    code: shortcut.code,
    appMode: state.appMode,
  });

  const isHoldingPlayAndRecordShortcut = controllerState.currentlyPressedKeys.has("ArrowUp")
    && controllerState.currentlyPressedKeys.has("Space");

  if (isHoldingPlayAndRecordShortcut && state.appMode === "project-editor") {
    updateAutomaticCaptureShortcutState({ state, controllerState });
    return true;
  }

  if (state.appMode === "project-editor" && state.isTimelapseCapturing) {
    log("ACTION: stop auto-capture because another shortcut was pressed");
    emitter.emit("timelapse:stop");
  }

  if (state.appMode === "project-browser") {
    if (state.isPlaying) {
      if (shortcut.isBackOrEscape || shortcut.isSpace || shortcut.isArrowUp) {
        emitter.emit("playback:stop");
      }

      return true;
    }

    if (state.projectBrowserModalProjectId && state.projectBrowserTitleEditor.isActive) {
      if (shortcut.key === "Escape") {
        emitter.emit("project-browser:cancel-title-edit");
        return true;
      }

      if (shortcut.key === "ArrowLeft") {
        emitter.emit("project-browser:move-title-keyboard-selection-previous");
        return true;
      }

      if (shortcut.key === "ArrowRight") {
        emitter.emit("project-browser:move-title-keyboard-selection-next");
        return true;
      }

      if (shortcut.isSpace) {
        if (shortcut.code === "Space") {
          emitter.emit("project-browser:type-title-character", " ");
        } else {
          emitter.emit("project-browser:activate-selected-title-key");
        }
        return true;
      }

      if (shortcut.key === "Backspace" || shortcut.key === "Delete") {
        emitter.emit("project-browser:delete-title-character");
        return true;
      }

      if (shortcut.isEnter) {
        emitter.emit("project-browser:save-title-edit");
        return true;
      }

      if (isPrintableProjectTitleShortcut(shortcut)) {
        emitter.emit("project-browser:type-title-character", shortcut.key);
        return true;
      }

      log("UNHANDLED PROJECT TITLE EDITOR SHORTCUT", shortcut.key);
      return false;
    }

    if (shortcut.isBackOrEscape && state.projectBrowserModalProjectId) {
      emitter.emit("project-browser:close-project-modal");
      return true;
    }

    if (state.projectBrowserModalProjectId) {
      if (shortcut.key === "ArrowLeft" || shortcut.key === "ArrowUp") {
        emitter.emit("project-browser:move-modal-selection-previous");
        return true;
      }

      if (shortcut.key === "ArrowRight" || shortcut.key === "ArrowDown") {
        emitter.emit("project-browser:move-modal-selection-next");
        return true;
      }

      if (shortcut.isSpace) {
        emitter.emit("project-browser:activate-selected-modal-action");
        return true;
      }

      log("UNHANDLED PROJECT BROWSER MODAL SHORTCUT", shortcut.key);
      return false;
    }

    if (shortcut.key === "ArrowLeft") {
      emitter.emit("project-browser:move-selection-left");
      return true;
    }

    if (shortcut.key === "ArrowRight") {
      emitter.emit("project-browser:move-selection-right");
      return true;
    }

    if (shortcut.key === "ArrowUp") {
      emitter.emit("project-browser:move-selection-up");
      return true;
    }

    if (shortcut.key === "ArrowDown") {
      emitter.emit("project-browser:move-selection-down");
      return true;
    }

    if (shortcut.isSpace) {
      emitter.emit("project-browser:activate-selected-tile");
      return true;
    }

    log("UNHANDLED PROJECT BROWSER SHORTCUT", shortcut.key);
    return false;
  }

  if (shortcut.isBackOrEscape) {
    emitter.emit("project-editor:return-to-browser");
    return true;
  }

  if (shortcut.isSpace) {
    log("ACTION: capture frame");
    emitter.emit("frames:capture");
    return true;
  }

  if (shortcut.key === "ArrowLeft") {
    if (controllerState.currentlyPressedKeys.has("ArrowUp")) {
      return adjustPlaybackSpeedFromShortcut({
        state,
        emitter,
        controllerState,
        adjustment: -1,
        log,
      });
    }

    if (shortcut.shiftKey) {
      log("ACTION: move selected frame left");
      emitter.emit("timeline:move-selected-frame-left");
      return true;
    }

    log("ACTION: move selection left");
    emitter.emit("timeline:move-selection-left");
    return true;
  }

  if (shortcut.key === "ArrowRight") {
    if (controllerState.currentlyPressedKeys.has("ArrowUp")) {
      return adjustPlaybackSpeedFromShortcut({
        state,
        emitter,
        controllerState,
        adjustment: 1,
        log,
      });
    }

    if (shortcut.shiftKey) {
      log("ACTION: move selected frame right");
      emitter.emit("timeline:move-selected-frame-right");
      return true;
    }

    log("ACTION: move selection right");
    emitter.emit("timeline:move-selection-right");
    return true;
  }

  if (shortcut.isArrowUp) {
    controllerState.playShortcutWasPressed = true;

    if (controllerState.currentlyPressedKeys.has("ArrowLeft")) {
      return adjustPlaybackSpeedFromShortcut({
        state,
        emitter,
        controllerState,
        adjustment: -1,
        log,
      });
    }

    if (controllerState.currentlyPressedKeys.has("ArrowRight")) {
      return adjustPlaybackSpeedFromShortcut({
        state,
        emitter,
        controllerState,
        adjustment: 1,
        log,
      });
    }

    log("ACTION: arm play on release");
    return true;
  }

  if (shortcut.isDelete) {
    log("ACTION: delete");
    emitter.emit("frames:delete-selected");
    return true;
  }

  log("UNHANDLED SHORTCUT", shortcut.key);
  return false;
}

function handleShortcutRelease({ state, emitter, controllerState, shortcut, log }) {
  controllerState.currentlyPressedKeys.delete(shortcut.pressedKey);

  if (state.appMode !== "project-editor") {
    return false;
  }

  if (shortcut.isSpace || shortcut.isArrowUp) {
    updateAutomaticCaptureShortcutState({ state, controllerState });
  }

  const automaticCaptureShortcutIsFullyReleased = !controllerState.currentlyPressedKeys.has("ArrowUp")
    && !controllerState.currentlyPressedKeys.has("Space");

  const automaticCaptureShortcutWasPressed = controllerState.automaticCaptureShortcutWasPressed;

  if (
    controllerState.automaticCaptureShortcutWasPressed
    && automaticCaptureShortcutIsFullyReleased
    && !state.isTimelapseCapturing
  ) {
    log("ACTION: toggle auto-capture on after shortcut press-and-release");
    controllerState.automaticCaptureShortcutWasPressed = false;
    controllerState.playShortcutWasPressed = false;
    controllerState.playbackSpeedShortcutWasUsed = false;
    emitter.emit("timelapse:start");
    return true;
  }

  if (automaticCaptureShortcutIsFullyReleased) {
    controllerState.automaticCaptureShortcutWasPressed = false;
  }

  if (shortcut.isArrowUp) {
    const shouldStartPlayback =
      controllerState.playShortcutWasPressed
      && !controllerState.playbackSpeedShortcutWasUsed
      && !automaticCaptureShortcutWasPressed;

    controllerState.playShortcutWasPressed = false;
    controllerState.playbackSpeedShortcutWasUsed = false;

    if (shouldStartPlayback) {
      log("ACTION: play on release");
      emitter.emit("playback:start");
      return true;
    }
  }

  return false;
}

function attachGlobalKeyboardListener(state, emitter) {
  if (hasAttachedGlobalKeyboardListener) {
    return;
  }

  hasAttachedGlobalKeyboardListener = true;
  const controllerState = createShortcutControllerState();

  function log(...args) {
    if (ENABLE_KEYBOARD_DEBUG_LOGGING) {
      console.log("[KEYBOARD]", ...args);
    }
  }

  function handleKeyboardShortcuts(event) {
    const shortcut = normalizeShortcutInput({
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });

    const handled = handleShortcutPress({
      state,
      emitter,
      controllerState,
      shortcut,
      log,
    });

    if (handled) {
      event.preventDefault();
    }
  }

  function handleKeyboardShortcutRelease(event) {
    const shortcut = normalizeShortcutInput({
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });

    handleShortcutRelease({
      state,
      emitter,
      controllerState,
      shortcut,
      log,
    });
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

function attachGamepadListener(state, emitter) {
  if (hasAttachedGamepadListener || typeof navigator === "undefined" || !navigator.getGamepads) {
    return;
  }

  hasAttachedGamepadListener = true;
  const controllerState = createShortcutControllerState();
  const pressedButtonIndexesByGamepadIndex = new Map();
  const pressedShortcutsByButtonIdentifier = new Map();

  function log(...args) {
    if (ENABLE_GAMEPAD_DEBUG_LOGGING) {
      console.log("[GAMEPAD]", ...args);
    }
  }

  function createButtonIdentifier(gamepadIndex, buttonIndex) {
    return `${gamepadIndex}:${buttonIndex}`;
  }

  function getShortcutForGamepadAction(gamepadAction, buttonIndex) {
    const keyboardKeyByGamepadAction = new Map([
      [GAMEPAD_ACTIONS.back, "Escape"],
      [GAMEPAD_ACTIONS.previous, "ArrowLeft"],
      [GAMEPAD_ACTIONS.next, "ArrowRight"],
      [GAMEPAD_ACTIONS.capture, "Space"],
      [GAMEPAD_ACTIONS.delete, "Delete"],
      [GAMEPAD_ACTIONS.play, "ArrowUp"],
    ]);
    const keyboardKey = keyboardKeyByGamepadAction.get(gamepadAction);

    return normalizeShortcutInput({
      key: keyboardKey,
      code: `GamepadButton${buttonIndex}`,
    });
  }

  function handleGamepadButtonDown(gamepadIndex, buttonIndex) {
    const gamepadAction = getGamepadActionForButton(buttonIndex);

    if (!gamepadAction) {
      return;
    }

    if (
      state.appMode === "project-browser"
      && state.projectBrowserModalProjectId
      && !state.projectBrowserTitleEditor.isActive
    ) {
      if (gamepadAction === GAMEPAD_ACTIONS.play) {
        emitter.emit("project-browser:play-modal-project");
        return;
      }

      if (gamepadAction === GAMEPAD_ACTIONS.delete) {
        emitter.emit("project-browser:delete-modal-project");
        return;
      }
    }

    if (state.appMode === "project-browser" && gamepadAction === GAMEPAD_ACTIONS.play) {
      return;
    }

    if (state.appMode === "project-browser" && gamepadAction === GAMEPAD_ACTIONS.delete) {
      return;
    }

    const shortcut = getShortcutForGamepadAction(gamepadAction, buttonIndex);

    pressedShortcutsByButtonIdentifier.set(
      createButtonIdentifier(gamepadIndex, buttonIndex),
      shortcut,
    );

    handleShortcutPress({
      state,
      emitter,
      controllerState,
      shortcut,
      log,
    });
  }

  function handleGamepadButtonUp(gamepadIndex, buttonIndex) {
    const buttonIdentifier = createButtonIdentifier(gamepadIndex, buttonIndex);
    const shortcut = pressedShortcutsByButtonIdentifier.get(buttonIdentifier)
      ?? null;

    pressedShortcutsByButtonIdentifier.delete(buttonIdentifier);

    if (!shortcut) {
      return;
    }

    handleShortcutRelease({
      state,
      emitter,
      controllerState,
      shortcut,
      log,
    });
  }

  function releaseDisconnectedGamepadButtons(gamepadIndex) {
    const previouslyPressedButtonIndexes = pressedButtonIndexesByGamepadIndex.get(gamepadIndex);

    if (!previouslyPressedButtonIndexes) {
      return;
    }

    for (const buttonIndex of previouslyPressedButtonIndexes) {
      handleGamepadButtonUp(gamepadIndex, buttonIndex);
    }

    pressedButtonIndexesByGamepadIndex.delete(gamepadIndex);
  }

  function pollGamepads() {
    const gamepads = navigator.getGamepads();

    for (const gamepad of gamepads) {
      if (!gamepad) {
        continue;
      }

      const previouslyPressedButtonIndexes = pressedButtonIndexesByGamepadIndex.get(gamepad.index)
        ?? new Set();
      const currentlyPressedButtonIndexes = new Set();

      for (let buttonIndex = 0; buttonIndex < gamepad.buttons.length; buttonIndex += 1) {
        if (!isMappedGamepadButton(buttonIndex)) {
          continue;
        }

        if (isGamepadButtonPressed(gamepad.buttons[buttonIndex])) {
          currentlyPressedButtonIndexes.add(buttonIndex);

          if (!previouslyPressedButtonIndexes.has(buttonIndex)) {
            handleGamepadButtonDown(gamepad.index, buttonIndex);
          }
        } else if (previouslyPressedButtonIndexes.has(buttonIndex)) {
          handleGamepadButtonUp(gamepad.index, buttonIndex);
        }
      }

      pressedButtonIndexesByGamepadIndex.set(gamepad.index, currentlyPressedButtonIndexes);
    }

    window.requestAnimationFrame(pollGamepads);
  }

  window.addEventListener("gamepaddisconnected", (gamepadEvent) => {
    releaseDisconnectedGamepadButtons(gamepadEvent.gamepad.index);
  });

  window.requestAnimationFrame(pollGamepads);
}

export default function applicationStore(state, emitter) {
  Object.assign(state, createInitialApplicationState());
  attachGlobalKeyboardListener(state, emitter);
  attachGamepadListener(state, emitter);

  let animationFrameIdentifierForTimelineScroll = null;
  let automaticCaptureTimeoutIdentifier = null;
  let automaticCaptureSessionIdentifier = 0;
  let pendingLayoutRefreshAnimationFrameIdentifier = null;
  let scheduledProjectPersistenceTimeoutIdentifier = null;
  let latestScheduledProjectPersistenceSnapshot = null;
  const thumbnailImageSourceCacheByStorageKey = new Map();
  const playbackImageSourceCacheByStorageKey = new Map();

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
    state.visibleTimelineItemCount = computeVisibleTimelineItemCount({
      timelinePanelWidth: state.appSurfaceLayout.width,
    });
  }

  async function getThumbnailImageSourceForStorageKey(storageKey) {
    if (!storageKey) {
      return null;
    }

    if (thumbnailImageSourceCacheByStorageKey.has(storageKey)) {
      return thumbnailImageSourceCacheByStorageKey.get(storageKey);
    }

    const thumbnailFile = await frameStorageService.readThumbnailFrameFile({
      storageKey,
    });
    const thumbnailImageSource = URL.createObjectURL(thumbnailFile);
    thumbnailImageSourceCacheByStorageKey.set(storageKey, thumbnailImageSource);
    return thumbnailImageSource;
  }

  async function getPlaybackImageSourceForStorageKey(storageKey) {
    if (!storageKey) {
      return null;
    }

    if (playbackImageSourceCacheByStorageKey.has(storageKey)) {
      return playbackImageSourceCacheByStorageKey.get(storageKey);
    }

    const originalFrameFile = await frameStorageService.readOriginalFrameFile({
      storageKey,
    });
    const playbackImageSource = URL.createObjectURL(originalFrameFile);
    playbackImageSourceCacheByStorageKey.set(storageKey, playbackImageSource);
    return playbackImageSource;
  }

  async function hydrateFrameImageSourcesFromStorage(frames) {
    return Promise.all(frames.map(async (frameRecord) => {
      if (
        !frameRecord?.thumbnailStorageKey
        || (frameRecord.timelineImageSource && frameRecord.previewImageSource)
      ) {
        return frameRecord;
      }

      try {
        const thumbnailImageSource = await getThumbnailImageSourceForStorageKey(
          frameRecord.thumbnailStorageKey,
        );

        return {
          ...frameRecord,
          timelineImageSource: frameRecord.timelineImageSource ?? thumbnailImageSource,
          previewImageSource: frameRecord.previewImageSource ?? thumbnailImageSource,
        };
      } catch (thumbnailHydrationError) {
        console.warn("Could not load frame thumbnail:", thumbnailHydrationError);
        return frameRecord;
      }
    }));
  }

  async function hydrateProjectThumbnailImageSourcesFromStorage(projects) {
    return Promise.all(projects.map(async (projectMetadata) => {
      if (!projectMetadata?.thumbnailStorageKey || projectMetadata.thumbnailImageSource) {
        return projectMetadata;
      }

      try {
        const thumbnailImageSource = await getThumbnailImageSourceForStorageKey(
          projectMetadata.thumbnailStorageKey,
        );

        return {
          ...projectMetadata,
          thumbnailImageSource,
        };
      } catch (thumbnailHydrationError) {
        console.warn("Could not load project thumbnail:", thumbnailHydrationError);
        return projectMetadata;
      }
    }));
  }

  async function hydrateFramePlaybackImageSourcesFromStorage(frames) {
    return Promise.all(frames.map(async (frameRecord) => {
      if (!frameRecord?.originalStorageKey || frameRecord.playbackImageSource) {
        return frameRecord;
      }

      try {
        const playbackImageSource = await getPlaybackImageSourceForStorageKey(
          frameRecord.originalStorageKey,
        );

        return {
          ...frameRecord,
          playbackImageSource,
        };
      } catch (playbackHydrationError) {
        console.warn("Could not load full-resolution frame for playback:", playbackHydrationError);
        return frameRecord;
      }
    }));
  }

  async function hydrateFramesForPlayback(frames) {
    const framesWithPreviewImageSources = await hydrateFrameImageSourcesFromStorage(frames);
    return hydrateFramePlaybackImageSourcesFromStorage(framesWithPreviewImageSources);
  }

  function revokeCachedThumbnailImageSource(storageKey) {
    if (!storageKey || !thumbnailImageSourceCacheByStorageKey.has(storageKey)) {
      return;
    }

    URL.revokeObjectURL(thumbnailImageSourceCacheByStorageKey.get(storageKey));
    thumbnailImageSourceCacheByStorageKey.delete(storageKey);
  }

  function revokeCachedPlaybackImageSource(storageKey) {
    if (!storageKey || !playbackImageSourceCacheByStorageKey.has(storageKey)) {
      return;
    }

    URL.revokeObjectURL(playbackImageSourceCacheByStorageKey.get(storageKey));
    playbackImageSourceCacheByStorageKey.delete(storageKey);
  }

  async function prepareFullResolutionPlaybackFrames() {
    await capturePersistenceService.waitForPendingFrameAssetPersistence();
    state.frames = await hydrateFramesForPlayback(state.frames);
  }

  async function reloadProjectsFromStorage() {
    state.projects = await hydrateProjectThumbnailImageSourcesFromStorage(
      await projectStorageService.listProjects(),
    );

    const projectBrowserTileList = createProjectBrowserTileList({
      projects: state.projects,
    });

    state.selectedProjectBrowserIndex = clampSelectionIndex({
      selectedIndex: state.selectedProjectBrowserIndex,
      tileCount: projectBrowserTileList.length,
    });
  }

  async function persistCurrentProjectState() {
    cancelScheduledCurrentProjectStatePersistence();
    const projectPersistenceSnapshot = createCurrentProjectPersistenceSnapshot();

    if (!projectPersistenceSnapshot) {
      return;
    }

    const updatedProjectMetadata = await capturePersistenceService.persistProjectState(
      projectPersistenceSnapshot,
    );

    state.currentProjectTitle = updatedProjectMetadata.title;
    await reloadProjectsFromStorage();
  }

  function createCurrentProjectPersistenceSnapshot() {
    if (!state.currentProjectId) {
      return null;
    }

    return {
      projectId: state.currentProjectId,
      frames: [...state.frames],
      title: state.currentProjectTitle,
    };
  }

  function scheduleCurrentProjectStatePersistenceInBackground() {
    const projectPersistenceSnapshot = createCurrentProjectPersistenceSnapshot();

    if (!projectPersistenceSnapshot) {
      return;
    }

    latestScheduledProjectPersistenceSnapshot = projectPersistenceSnapshot;

    if (scheduledProjectPersistenceTimeoutIdentifier !== null) {
      window.clearTimeout(scheduledProjectPersistenceTimeoutIdentifier);
    }

    scheduledProjectPersistenceTimeoutIdentifier = window.setTimeout(() => {
      scheduledProjectPersistenceTimeoutIdentifier = null;
      persistLatestScheduledProjectStateInBackground();
    }, BACKGROUND_PROJECT_PERSISTENCE_DELAY_MILLISECONDS);
  }

  function cancelScheduledCurrentProjectStatePersistence() {
    if (scheduledProjectPersistenceTimeoutIdentifier !== null) {
      window.clearTimeout(scheduledProjectPersistenceTimeoutIdentifier);
      scheduledProjectPersistenceTimeoutIdentifier = null;
    }

    latestScheduledProjectPersistenceSnapshot = null;
  }

  function persistLatestScheduledProjectStateInBackground() {
    const projectPersistenceSnapshot = latestScheduledProjectPersistenceSnapshot;
    latestScheduledProjectPersistenceSnapshot = null;

    if (!projectPersistenceSnapshot) {
      return;
    }

    capturePersistenceService.persistProjectState(projectPersistenceSnapshot)
      .then(async (updatedProjectMetadata) => {
        if (state.currentProjectId === updatedProjectMetadata.id) {
          state.currentProjectTitle = updatedProjectMetadata.title;
        }

        await reloadProjectsFromStorage();
        emitter.emit("render");
      })
      .catch((projectPersistenceError) => {
        console.error("Failed to persist project state:", projectPersistenceError);
      });
  }

  async function openProjectInEditorById({ projectId }) {
    const loadedProject = await projectStorageService.loadProject({ projectId });

    state.currentProjectId = loadedProject.id;
    state.currentProjectTitle = loadedProject.title;
    state.frames = await hydrateFrameImageSourcesFromStorage(loadedProject.frames);
    state.selectedTimelineItem = {
      type: "gap",
      index: state.frames.length,
    };
    state.timelineScrollOffsetInItemUnits = 0;
    state.timelineScrollTargetOffsetInItemUnits = 0;
    updateTimelineScrollTargetAndClampCurrentOffset();
    state.appMode = "project-editor";
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
    clearProjectBrowserPlaybackState();

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
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
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
    state.projectBrowserModalStatusMessage = null;
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
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
  }

  function getProjectMetadataForProjectBrowserModal() {
    if (!state.projectBrowserModalProjectId) {
      return null;
    }

    return state.projects.find(
      (projectMetadata) => projectMetadata.id === state.projectBrowserModalProjectId,
    ) ?? null;
  }

  function clearProjectBrowserTitleEditor() {
    state.projectBrowserTitleEditor = createInactiveProjectTitleEditorState();
  }

  function clearProjectBrowserPlaybackState() {
    state.projectBrowserPlaybackProjectId = null;
    state.projectBrowserPlaybackTitle = null;
    state.projectBrowserPlaybackFrames = [];
  }

  async function openProjectBrowserModalProjectInEditor() {
    const selectedProjectMetadata = getProjectMetadataForProjectBrowserModal();

    if (!selectedProjectMetadata) {
      state.projectBrowserModalProjectId = null;
      state.projectBrowserModalSelectedActionIndex = 0;
      state.projectBrowserModalStatusMessage = null;
      clearProjectBrowserTitleEditor();
      return;
    }

    state.selectedProjectBrowserIndex = findBrowserSelectionIndexForProjectId({
      projects: state.projects,
      projectId: selectedProjectMetadata.id,
    });
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();

    await openProjectInEditorById({
      projectId: selectedProjectMetadata.id,
    });
  }

  async function playProjectBrowserModalProjectFullscreen() {
    if (state.isPlaying) {
      return;
    }

    const selectedProjectMetadata = getProjectMetadataForProjectBrowserModal();

    if (!selectedProjectMetadata) {
      state.projectBrowserModalProjectId = null;
      state.projectBrowserModalSelectedActionIndex = 0;
      state.projectBrowserModalStatusMessage = null;
      clearProjectBrowserTitleEditor();
      clearProjectBrowserPlaybackState();
      return;
    }

    await capturePersistenceService.waitForPendingProjectPersistence();

    const projectToPlay = await projectStorageService.loadProject({
      projectId: selectedProjectMetadata.id,
    });

    if (!projectToPlay.frames.length) {
      state.projectBrowserModalStatusMessage = "Project has no frames.";
      clearProjectBrowserTitleEditor();
      clearProjectBrowserPlaybackState();
      return;
    }

    const playbackFrames = await hydrateFramesForPlayback(projectToPlay.frames);

    state.projectBrowserPlaybackProjectId = projectToPlay.id;
    state.projectBrowserPlaybackTitle = projectToPlay.title;
    state.projectBrowserPlaybackFrames = playbackFrames;
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();

    state.isPlaying = true;
    state.playbackFrameIndex = 0;
    emitter.emit("render");

    playbackController.playFrames({
      frames: state.projectBrowserPlaybackFrames,
      framesPerSecond: state.playbackFramesPerSecond,
      getFramesPerSecond() {
        return state.playbackFramesPerSecond;
      },
      onFrameChange(frameIndex) {
        if (
          state.appMode !== "project-browser"
          || state.projectBrowserPlaybackProjectId !== projectToPlay.id
        ) {
          return;
        }

        state.playbackFrameIndex = frameIndex;
        emitter.emit("render");
      },
      onComplete() {
        if (
          state.appMode !== "project-browser"
          || state.projectBrowserPlaybackProjectId !== projectToPlay.id
        ) {
          return;
        }

        state.isPlaying = false;
        state.playbackFrameIndex = null;
        clearProjectBrowserPlaybackState();
        emitter.emit("render");
      },
    });
  }

  async function editProjectBrowserModalProjectTitle() {
    const selectedProjectMetadata = getProjectMetadataForProjectBrowserModal();

    if (!selectedProjectMetadata) {
      state.projectBrowserModalProjectId = null;
      state.projectBrowserModalSelectedActionIndex = 0;
      state.projectBrowserModalStatusMessage = null;
      clearProjectBrowserTitleEditor();
      return;
    }

    state.projectBrowserModalStatusMessage = null;
    state.projectBrowserTitleEditor = createProjectTitleEditorState({
      title: selectedProjectMetadata.title,
    });
  }

  async function saveProjectBrowserModalProjectTitle(nextProjectTitle) {
    const selectedProjectMetadata = getProjectMetadataForProjectBrowserModal();

    if (!selectedProjectMetadata) {
      state.projectBrowserModalProjectId = null;
      state.projectBrowserModalSelectedActionIndex = 0;
      state.projectBrowserModalStatusMessage = null;
      clearProjectBrowserTitleEditor();
      return;
    }

    const projectToRename = await projectStorageService.loadProject({
      projectId: selectedProjectMetadata.id,
    });

    await projectStorageService.saveProject({
      projectId: selectedProjectMetadata.id,
      frames: projectToRename.frames,
      title: nextProjectTitle,
    });
    await reloadProjectsFromStorage();

    state.selectedProjectBrowserIndex = findBrowserSelectionIndexForProjectId({
      projects: state.projects,
      projectId: selectedProjectMetadata.id,
    });
    state.projectBrowserModalStatusMessage = "Project title updated.";
    clearProjectBrowserTitleEditor();
  }

  function moveProjectBrowserTitleKeyboardSelectionByOffset(offset) {
    state.projectBrowserTitleEditor = {
      ...state.projectBrowserTitleEditor,
      selectedKeyIndex: moveProjectTitleKeyboardSelection({
        selectedKeyIndex: state.projectBrowserTitleEditor.selectedKeyIndex,
        offset,
      }),
    };
  }

  function selectProjectBrowserTitleKeyboardKey(keyIndex) {
    state.projectBrowserTitleEditor = {
      ...state.projectBrowserTitleEditor,
      selectedKeyIndex: Math.min(
        Math.max(0, keyIndex),
        PROJECT_TITLE_KEYBOARD_KEYS.length - 1,
      ),
    };
  }

  function typeProjectBrowserTitleCharacter(character) {
    if (typeof character !== "string" || character.length < 1) {
      return;
    }

    state.projectBrowserTitleEditor = {
      ...state.projectBrowserTitleEditor,
      draftTitle: `${state.projectBrowserTitleEditor.draftTitle}${character}`.slice(
        0,
        PROJECT_TITLE_MAXIMUM_LENGTH,
      ),
    };
    state.projectBrowserModalStatusMessage = null;
  }

  function deleteProjectBrowserTitleCharacter() {
    state.projectBrowserTitleEditor = {
      ...state.projectBrowserTitleEditor,
      draftTitle: state.projectBrowserTitleEditor.draftTitle.slice(0, -1),
    };
    state.projectBrowserModalStatusMessage = null;
  }

  async function saveProjectBrowserTitleEditorDraft() {
    const nextProjectTitle = state.projectBrowserTitleEditor.draftTitle.trim();

    if (!nextProjectTitle) {
      state.projectBrowserModalStatusMessage = "Title cannot be empty.";
      return;
    }

    await saveProjectBrowserModalProjectTitle(nextProjectTitle);
  }

  async function activateSelectedProjectBrowserTitleKey() {
    const selectedKey = PROJECT_TITLE_KEYBOARD_KEYS[
      state.projectBrowserTitleEditor.selectedKeyIndex
    ];
    const keyApplicationResult = applyProjectTitleKeyboardKey({
      draftTitle: state.projectBrowserTitleEditor.draftTitle,
      key: selectedKey,
    });

    if (keyApplicationResult.action === "edit") {
      state.projectBrowserTitleEditor = {
        ...state.projectBrowserTitleEditor,
        draftTitle: keyApplicationResult.draftTitle,
      };
      state.projectBrowserModalStatusMessage = null;
      return;
    }

    if (keyApplicationResult.action === "save") {
      await saveProjectBrowserModalProjectTitle(keyApplicationResult.titleToSave);
      return;
    }

    if (keyApplicationResult.action === "cancel") {
      state.projectBrowserModalStatusMessage = null;
      clearProjectBrowserTitleEditor();
      return;
    }

    if (selectedKey?.type === "save") {
      state.projectBrowserModalStatusMessage = "Title cannot be empty.";
    }
  }

  function markProjectBrowserModalActionUnavailable(actionLabel) {
    state.projectBrowserModalStatusMessage = `${actionLabel} is not available yet.`;
  }

  async function deleteProjectInProjectBrowserModal() {
    const selectedProjectMetadata = getProjectMetadataForProjectBrowserModal();

    if (!selectedProjectMetadata) {
      state.projectBrowserModalProjectId = null;
      state.projectBrowserModalSelectedActionIndex = 0;
      state.projectBrowserModalStatusMessage = null;
      clearProjectBrowserTitleEditor();
      return;
    }

    await capturePersistenceService.waitForPendingProjectPersistence();

    const projectToDelete = await projectStorageService.loadProject({
      projectId: selectedProjectMetadata.id,
    });

    for (const frameRecord of projectToDelete.frames) {
      if (frameRecord?.originalStorageKey) {
        try {
          await frameStorageService.deleteOriginalFrame({
            storageKey: frameRecord.originalStorageKey,
          });
          revokeCachedPlaybackImageSource(frameRecord.originalStorageKey);
        } catch (originalFrameDeleteError) {
          console.warn("Could not delete a project frame original asset:", originalFrameDeleteError);
        }
      }

      if (frameRecord?.thumbnailStorageKey) {
        try {
          await frameStorageService.deleteThumbnailFrame({
            storageKey: frameRecord.thumbnailStorageKey,
          });
          revokeCachedThumbnailImageSource(frameRecord.thumbnailStorageKey);
        } catch (thumbnailFrameDeleteError) {
          console.warn("Could not delete a project frame thumbnail asset:", thumbnailFrameDeleteError);
        }
      }
    }

    await projectStorageService.deleteProject({
      projectId: selectedProjectMetadata.id,
    });
    await reloadProjectsFromStorage();
    state.projectBrowserModalProjectId = null;
    state.projectBrowserModalSelectedActionIndex = 0;
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
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
      if (
        cameraService.supportsFastCapturePipeline()
        && capturePersistenceService.supportsBackgroundCapturePipeline()
      ) {
        return await captureAndInsertFrameRecordWithBackgroundPersistence({
          frameIdentifier,
          captureFlowStartedAtMilliseconds,
        });
      }

      return await captureAndInsertFrameRecordWithSynchronousPersistence({
        frameIdentifier,
        captureFlowStartedAtMilliseconds,
      });
    } finally {
      state.isCaptureOperationInProgress = false;
      updateCaptureReadinessFromCurrentState();
      emitter.emit("render");
    }
  }

  async function captureAndInsertFrameRecordWithBackgroundPersistence({
    frameIdentifier,
    captureFlowStartedAtMilliseconds,
  }) {
    const originalStorageKey = createOriginalFrameStorageKey(frameIdentifier);
    const thumbnailStorageKey = createThumbnailFrameStorageKey(frameIdentifier);
    const capturedFrameData = await measureAsyncOperationDuration({
      operationName: "camera-frame-thumbnail-capture",
      frameIdentifier,
      operation: () => cameraService.captureFramePreviewDataForBackgroundPersistence(),
    });

    try {
      const didQueueAssetPersistence = capturePersistenceService.saveCapturedFrameAssets({
        frameId: frameIdentifier,
        sourceImageBitmap: capturedFrameData.sourceImageBitmap,
        timelineBlob: capturedFrameData.timelineBlob,
        width: capturedFrameData.width,
        height: capturedFrameData.height,
      });

      if (!didQueueAssetPersistence) {
        capturedFrameData.sourceImageBitmap?.close?.();
        URL.revokeObjectURL(capturedFrameData.timelineImageSource);

        return await captureAndInsertFrameRecordWithSynchronousPersistence({
          frameIdentifier,
          captureFlowStartedAtMilliseconds,
        });
      }
    } catch (assetPersistenceQueueError) {
      capturedFrameData.sourceImageBitmap?.close?.();
      URL.revokeObjectURL(capturedFrameData.timelineImageSource);
      throw assetPersistenceQueueError;
    }

    const capturedFrameRecordData = {
      id: frameIdentifier,
      timelineImageSource: capturedFrameData.timelineImageSource,
      previewImageSource: capturedFrameData.previewImageSource,
      originalStorageKey,
      thumbnailStorageKey,
      width: capturedFrameData.width,
      height: capturedFrameData.height,
    };

    const insertionResult = insertCapturedFrameRecordAndUpdateTimeline({
      capturedFrameRecordData,
    });

    await cleanupReplacedFrameAssetsIfNeeded(insertionResult);

    console.info("Frame capture ready timing", {
      frameIdentifier,
      persistenceMode: "background-worker",
      thumbnailCaptureDurationMilliseconds: capturedFrameData.captureDurationMilliseconds,
      captureReadyDurationMilliseconds: performance.now() - captureFlowStartedAtMilliseconds,
      timelineBlobSizeInBytes: capturedFrameData.timelineBlobSizeInBytes,
    });

    scheduleCurrentProjectStatePersistenceInBackground();
    return true;
  }

  async function captureAndInsertFrameRecordWithSynchronousPersistence({
    frameIdentifier,
    captureFlowStartedAtMilliseconds,
  }) {
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

    const capturedFrameRecordData = {
      id: frameIdentifier,
      timelineImageSource: capturedFrameData.timelineImageSource,
      previewImageSource: capturedFrameData.previewImageSource,
      originalStorageKey: originalFrameSaveResult.operationResult,
      width: capturedFrameData.width,
      height: capturedFrameData.height,
    };

    const insertionResult = insertCapturedFrameRecordAndUpdateTimeline({
      capturedFrameRecordData,
    });

    await cleanupReplacedFrameAssetsIfNeeded(insertionResult);
    await persistCurrentProjectState();

    console.info("Frame capture ready timing", {
      frameIdentifier,
      persistenceMode: "synchronous-fallback",
      captureDurationMilliseconds: capturedFrameData.captureDurationMilliseconds,
      originalFrameSaveDurationMilliseconds: originalFrameSaveResult.captureDurationMilliseconds,
      captureReadyDurationMilliseconds: performance.now() - captureFlowStartedAtMilliseconds,
      originalBlobSizeInBytes: capturedFrameData.originalBlobSizeInBytes,
      timelineBlobSizeInBytes: capturedFrameData.timelineBlobSizeInBytes,
    });

    return true;
  }

  function insertCapturedFrameRecordAndUpdateTimeline({ capturedFrameRecordData }) {
    const insertionResult = insertCapturedFrameAtCurrentSelection({
      frames: state.frames,
      selectedTimelineItem: state.selectedTimelineItem,
      capturedFrameRecordData,
    });

    state.frames = insertionResult.frames;
    state.selectedTimelineItem = insertionResult.selectedTimelineItem;
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();

    return insertionResult;
  }

  async function cleanupReplacedFrameAssetsIfNeeded(insertionResult) {
    if (!insertionResult.replacedFrameRecord) {
      return;
    }

    try {
      await cleanupDeletedFrameAssets(insertionResult.replacedFrameRecord);
    } catch (replaceCleanupError) {
      console.error("Failed to clean up replaced frame assets:", replaceCleanupError);
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

    await capturePersistenceService.waitForPendingProjectPersistence();

    await capturePersistenceService.deleteFrameAssets({
      originalStorageKey: deletedFrameRecord.originalStorageKey,
      thumbnailStorageKey: deletedFrameRecord.thumbnailStorageKey,
    });

    revokeCachedPlaybackImageSource(deletedFrameRecord.originalStorageKey);

    if (deletedFrameRecord.thumbnailStorageKey) {
      revokeCachedThumbnailImageSource(deletedFrameRecord.thumbnailStorageKey);
    }
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
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
    clearProjectBrowserPlaybackState();
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
    updateTimelineScrollTargetAndClampCurrentOffset();
    animateTimelineScrollOffsetTowardsTargetIfNeeded();
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
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
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

  emitter.on("project-browser:move-title-keyboard-selection-previous", () => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    moveProjectBrowserTitleKeyboardSelectionByOffset(-1);
    emitter.emit("render");
  });

  emitter.on("project-browser:move-title-keyboard-selection-next", () => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    moveProjectBrowserTitleKeyboardSelectionByOffset(1);
    emitter.emit("render");
  });

  emitter.on("project-browser:activate-selected-title-key", async () => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    await activateSelectedProjectBrowserTitleKey();
    emitter.emit("render");
  });

  emitter.on("project-browser:activate-title-key", async (keyIndex) => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    selectProjectBrowserTitleKeyboardKey(keyIndex);
    await activateSelectedProjectBrowserTitleKey();
    emitter.emit("render");
  });

  emitter.on("project-browser:type-title-character", (character) => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    typeProjectBrowserTitleCharacter(character);
    emitter.emit("render");
  });

  emitter.on("project-browser:delete-title-character", () => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    deleteProjectBrowserTitleCharacter();
    emitter.emit("render");
  });

  emitter.on("project-browser:save-title-edit", async () => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    await saveProjectBrowserTitleEditorDraft();
    emitter.emit("render");
  });

  emitter.on("project-browser:cancel-title-edit", () => {
    if (
      state.appMode !== "project-browser"
      || !state.projectBrowserModalProjectId
      || !state.projectBrowserTitleEditor.isActive
    ) {
      return;
    }

    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
    emitter.emit("render");
  });

  emitter.on("project-browser:activate-selected-modal-action", async () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    const selectedModalActionKey = projectBrowserModalActionList[state.projectBrowserModalSelectedActionIndex];

    if (selectedModalActionKey === "play-project") {
      await playProjectBrowserModalProjectFullscreen();
      emitter.emit("render");
      return;
    }

    if (selectedModalActionKey === "edit-project") {
      await openProjectBrowserModalProjectInEditor();
      emitter.emit("render");
      return;
    }

    if (selectedModalActionKey === "edit-title") {
      await editProjectBrowserModalProjectTitle();
      emitter.emit("render");
      return;
    }

    if (selectedModalActionKey === "record-sound") {
      markProjectBrowserModalActionUnavailable("Record sound");
      emitter.emit("render");
      return;
    }

    if (selectedModalActionKey === "export-video") {
      markProjectBrowserModalActionUnavailable("Export video");
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
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
    emitter.emit("render");
  });

  emitter.on("project-browser:play-modal-project", async () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    await playProjectBrowserModalProjectFullscreen();
    emitter.emit("render");
  });

  emitter.on("project-browser:edit-modal-project", async () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    await openProjectBrowserModalProjectInEditor();
    emitter.emit("render");
  });

  emitter.on("project-browser:edit-modal-project-title", async () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    await editProjectBrowserModalProjectTitle();
    emitter.emit("render");
  });

  emitter.on("project-browser:record-modal-project-sound", () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    markProjectBrowserModalActionUnavailable("Record sound");
    emitter.emit("render");
  });

  emitter.on("project-browser:export-modal-project-video", () => {
    if (state.appMode !== "project-browser" || !state.projectBrowserModalProjectId) {
      return;
    }

    markProjectBrowserModalActionUnavailable("Export video");
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
    state.projectBrowserModalStatusMessage = null;
    clearProjectBrowserTitleEditor();
    clearProjectBrowserPlaybackState();
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

  emitter.on("playback:start", async () => {
    if (state.appMode !== "project-editor" || state.isPlaying || state.isTimelapseCapturing || !canPlayFrames(state)) {
      return;
    }

    await prepareFullResolutionPlaybackFrames();

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
      framesPerSecond: state.playbackFramesPerSecond,
      getFramesPerSecond() {
        return state.playbackFramesPerSecond;
      },
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

  emitter.on("playback:adjust-speed", (adjustment) => {
    if (state.appMode !== "project-editor") {
      return;
    }

    state.playbackFramesPerSecond = adjustPlaybackFramesPerSecond({
      framesPerSecond: state.playbackFramesPerSecond,
      adjustment,
    });
    emitter.emit("render");
  });

  emitter.on("playback:stop", () => {
    const playbackWasInProjectBrowser = state.appMode === "project-browser";

    playbackController.stop();
    state.isPlaying = false;
    state.playbackFrameIndex = null;

    if (playbackWasInProjectBrowser) {
      clearProjectBrowserPlaybackState();
    } else {
      updateTimelineScrollTargetAndClampCurrentOffset();
      animateTimelineScrollOffsetTowardsTargetIfNeeded();
    }

    emitter.emit("render");
  });
}
