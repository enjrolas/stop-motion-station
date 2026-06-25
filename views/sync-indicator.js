import computeSyncIndicatorColor from "../helpers/sync-indicator-color.js";

const SYNC_INDICATOR_TITLES = {
  synced: "Backend sync up to date",
  syncing: "Syncing to backend…",
  offline: "No network connection",
};

// Small fixed status dot in the top-right corner. Hidden when sync is disabled.
export default function syncIndicator(state) {
  const indicatorColor = computeSyncIndicatorColor({
    syncStatus: state.syncStatus,
    isOnline: state.isOnline,
  });

  if (!indicatorColor) {
    return null;
  }

  return html`
    <div
      class=${`sync-indicator sync-indicator--${indicatorColor}`}
      title=${SYNC_INDICATOR_TITLES[indicatorColor]}
    ></div>
  `;
}
