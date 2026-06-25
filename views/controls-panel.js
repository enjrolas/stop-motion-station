export function describeSyncStatus(syncStatus) {
  if (!syncStatus || !syncStatus.enabled) {
    return { label: "Sync off", detail: "Backend sync is not configured.", stateClassName: "is-disabled" };
  }

  const pendingSuffix = syncStatus.pendingProjectCount > 0
    ? ` (${syncStatus.pendingProjectCount} pending)`
    : "";

  if (syncStatus.state === "syncing") {
    return { label: `Syncing…${pendingSuffix}`, detail: syncStatus.message, stateClassName: "is-syncing" };
  }

  if (syncStatus.state === "error") {
    return {
      label: `Sync retrying${pendingSuffix}`,
      detail: syncStatus.lastErrorMessage ?? syncStatus.message,
      stateClassName: "is-error",
    };
  }

  if (syncStatus.state === "synced") {
    return { label: "Synced", detail: "All changes saved to the backend.", stateClassName: "is-synced" };
  }

  return { label: "Sync ready", detail: syncStatus.message, stateClassName: "is-ready" };
}

export function describeVideoExportStatus(videoExportStatus) {
  const exportState = videoExportStatus?.state ?? "idle";

  if (exportState === "rendering") {
    return { label: "Rendering video…", stateClassName: "is-syncing" };
  }

  if (exportState === "uploading") {
    return { label: "Uploading video…", stateClassName: "is-syncing" };
  }

  if (exportState === "uploaded") {
    return { label: "Video synced", stateClassName: "is-synced" };
  }

  if (exportState === "error") {
    return { label: "Video render retrying", stateClassName: "is-error" };
  }

  if (exportState === "unsupported") {
    return { label: "Video export unsupported", stateClassName: "is-disabled" };
  }

  return { label: "Video idle", stateClassName: "is-ready" };
}

export default function controlsPanel(state) {
  const { controlsWidth, previewHeight } = state.appSurfaceLayout;
  const syncStatusDescription = describeSyncStatus(state.syncStatus);
  const videoExportStatusDescription = describeVideoExportStatus(state.videoExportStatus);
  const automaticCaptureIsEnabled = state.isTimelapseCapturing;
  const automaticCaptureStatusMessage = automaticCaptureIsEnabled
    ? `Taking picture in ${state.autoCaptureCountdownSecondsRemaining ?? 3}...`
    : "Auto-capture is ready.";
  const captureIsReady = state.captureReadinessStatus === "capture-ready";
  const captureReadinessStatusMessage = captureIsReady
    ? "Capture ready. Press Space or B3 to take a picture."
    : "Busy preparing the most recent frame. New captures are temporarily blocked.";

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
      ${state.syncStatus?.enabled
        ? html`
          <section class="backend-sync-panel">
            <div class="backend-sync-title">Backend sync</div>
            <div class=${`backend-sync-state ${syncStatusDescription.stateClassName}`}>
              ${syncStatusDescription.label}
            </div>
            <div class="backend-sync-detail">${syncStatusDescription.detail}</div>
            <div class=${`backend-sync-state ${videoExportStatusDescription.stateClassName}`}>
              ${videoExportStatusDescription.label}
            </div>
          </section>
        `
        : null}
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
