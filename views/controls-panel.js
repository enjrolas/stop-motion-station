export default function controlsPanel(state) {
  const { controlsWidth, previewHeight } = state.appSurfaceLayout;
  const automaticCaptureIsEnabled = state.isTimelapseCapturing;
  const automaticCaptureStatusMessage = automaticCaptureIsEnabled
    ? `Taking picture in ${state.autoCaptureCountdownSecondsRemaining ?? 3}...`
    : "Auto-capture is ready.";
  const captureIsReady = state.captureReadinessStatus === "capture-ready";
  const captureReadinessStatusMessage = captureIsReady
    ? "Capture ready. Press Space to take a picture."
    : "Busy saving the most recent frame. New captures are temporarily blocked.";

  return html`
    <aside class="controls-panel" style=${`width: ${controlsWidth}px; height: ${previewHeight}px;`}>
      <section class="auto-capture-indicator-panel">
        <div class="auto-capture-indicator-title">Auto-capture</div>
        <div class="auto-capture-status-text">
          ${automaticCaptureStatusMessage}
        </div>
        <div class="auto-capture-shortcut-hint">
          Press and release Up and Space together to start auto-capture. Press any other key to stop.
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
      <section class="keyboard-controls-panel">
        <div class="keyboard-controls-title">Keyboard controls</div>
        <ul class="keyboard-controls-list">
          <li>space for capture</li>
          <li>up for play</li>
          <li>down/delete/backspace for delete</li>
          <li>esc/w for back to browser</li>
          <li>arrows to navigate timeline</li>
          <li>shift + left/right to reorder a selected frame</li>
        </ul>
      </section>
    </aside>
  `;
}
