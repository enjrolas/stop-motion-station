// Small fixed status pill shown while a reopened project's offloaded full-res
// frames are being re-downloaded from the backend. Hidden when no restore is in
// progress. The timeline keeps rendering from thumbnails throughout; this just
// communicates that full-resolution frames are still arriving.
export default function frameRestoreIndicator(state) {
  const backendPullStatus = state.backendPullStatus;
  if (backendPullStatus && backendPullStatus.active) {
    const importedCount = backendPullStatus.imported || 0;
    const label = importedCount
      ? `Importing projects from server (${importedCount})…`
      : "Checking server for projects…";
    return html`
      <div class="frame-restore-indicator" title="Pulling projects from the backend into local storage">
        ${label}
      </div>
    `;
  }

  const frameRestoreStatus = state.frameRestoreStatus;

  if (!frameRestoreStatus || !frameRestoreStatus.active) {
    return null;
  }

  const total = frameRestoreStatus.total || 0;
  const restored = frameRestoreStatus.restored || 0;
  const label = total
    ? `Restoring frames ${restored}/${total}…`
    : "Restoring frames…";

  return html`
    <div class="frame-restore-indicator" title="Downloading full-resolution frames from the backend">
      ${label}
    </div>
  `;
}
