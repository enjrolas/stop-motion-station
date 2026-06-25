// Secret diagnostics overlay, toggled with the "d" key (debug:toggle-view).
// Hidden in the standard view. Fixed-position so it sits above whatever mode is
// on screen. Reads straight from app state; extend freely as more debug signals
// are needed.
function formatBytes(byteCount) {
  if (!Number.isFinite(byteCount) || byteCount <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = byteCount;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function debugRow(label, value) {
  return html`
    <div class="debug-overlay-row">
      <span class="debug-overlay-label">${label}</span>
      <span class="debug-overlay-value">${value}</span>
    </div>
  `;
}

export default function debugOverlay(state) {
  if (!state.isDebugViewEnabled) {
    return null;
  }

  const storageEstimate = state.debugStorageEstimate;
  let storageValue = "—";
  if (storageEstimate && storageEstimate.quotaBytes > 0) {
    const usedPercent = Math.round((storageEstimate.usageBytes / storageEstimate.quotaBytes) * 100);
    storageValue = `${formatBytes(storageEstimate.usageBytes)} / ${formatBytes(storageEstimate.quotaBytes)} (${usedPercent}%)`;
  }

  const syncStatus = state.syncStatus ?? {};
  const videoExportStatus = state.videoExportStatus ?? {};
  const frameRestoreStatus = state.frameRestoreStatus;

  return html`
    <div class="debug-overlay">
      <div class="debug-overlay-title">Debug view · press "d" to close</div>
      ${debugRow("App mode", state.appMode)}
      ${debugRow("Projects", String(state.projects?.length ?? 0))}
      ${debugRow("Current project", state.currentProjectTitle ?? "—")}
      ${debugRow("Current project id", state.currentProjectId ?? "—")}
      ${debugRow("Frames (open)", String(state.frames?.length ?? 0))}
      ${debugRow("Storage", storageValue)}
      ${debugRow("Online", state.isOnline ? "yes" : "no")}
      ${debugRow("Sync", `${syncStatus.state ?? "—"} · pending ${syncStatus.pendingProjectCount ?? 0}`)}
      ${debugRow("Video export", videoExportStatus.state ?? "—")}
      ${debugRow(
        "Frame restore",
        frameRestoreStatus
          ? `${frameRestoreStatus.restored ?? 0}/${frameRestoreStatus.total ?? 0}${frameRestoreStatus.failed ? " (failed)" : ""}`
          : "idle",
      )}
    </div>
  `;
}
