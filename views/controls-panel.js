export default function controlsPanel(state) {
  const { controlsWidth, previewHeight } = state.appSurfaceLayout;
  const automaticCaptureIsEnabled = state.isTimelapseCapturing;
  const automaticCaptureStatusMessage = automaticCaptureIsEnabled
    ? `Taking picture in ${state.autoCaptureCountdownSecondsRemaining ?? 3}...`
    : "Auto-capture is ready.";
  const captureIsReady = state.captureReadinessStatus === "capture-ready";
  // Keep this description constant across ready/busy so the panel never changes
  // height (and the layout never jumps) when a capture briefly goes busy. The
  // ready/busy state is conveyed by the single-line label below.
  const captureReadinessStatusMessage = "Press Space or B3 to take a picture.";

  return html`
    <aside class="controls-panel" style=${`width: ${controlsWidth}px; height: ${previewHeight}px;`}>
      <section class="auto-capture-indicator-panel">
        <div class="auto-capture-indicator-title">Auto-capture</div>
        <div class="auto-capture-status-text">
          ${automaticCaptureStatusMessage}
        </div>
        <div class="auto-capture-shortcut-hint">
          Press and release Up + Space or Play + Capture together to start auto-capture.
        </div>
      </section>
      <section class="capture-readiness-indicator-panel">
        <div class="capture-readiness-indicator-title">Capture status</div>
        <div class=${`capture-readiness-state ${captureIsReady ? "is-ready" : "is-busy"}`}>
          ${captureIsReady ? "Capture ready" : "Busy"}
        </div>
        <div class="capture-readiness-status-text">
          ${captureReadinessStatusMessage}
        </div>
      </section>
      <section class="playback-speed-panel">
        <div class="playback-speed-title">Playback speed</div>
        <div class="playback-speed-value">${state.playbackFramesPerSecond} fps</div>
      </section>
      <section class="keyboard-controls-panel">
        <div class="keyboard-controls-title">Controls</div>
        <ul class="keyboard-controls-list">
          <li>space / B3 capture</li>
          <li>up / B5 play</li>
          <li>left/right / B1 B2 previous/next</li>
          <li>esc/w / B0 back</li>
          <li>down/delete/backspace / B4 delete</li>
          <li>shift + left/right to reorder a selected frame</li>
        </ul>
      </section>
    </aside>
  `;
}
