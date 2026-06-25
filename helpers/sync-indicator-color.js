// Resolves the small top-right status dot color from the sync state and the
// browser's network connectivity:
//   - "offline" (blue):  no network connection
//   - "syncing" (yellow): a sync is in progress, pending, or retrying
//   - "synced"  (green):  online and everything is synced
// Returns null when backend sync is disabled (the dot is hidden).
export default function computeSyncIndicatorColor({ syncStatus, isOnline }) {
  if (!syncStatus || !syncStatus.enabled) {
    return null;
  }

  if (!isOnline) {
    return "offline";
  }

  if (
    syncStatus.state === "syncing"
    || syncStatus.state === "error"
    || (syncStatus.pendingProjectCount ?? 0) > 0
  ) {
    return "syncing";
  }

  return "synced";
}
