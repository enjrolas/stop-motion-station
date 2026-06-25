// Decides whether a project is *fully backed up* to the gallery server — the
// safety gate that must hold before any of its locally stored frame images may
// be evicted. A project qualifies only when every current local frame is
// provably retrievable from the backend, i.e. each frame position (1-based) maps
// to that exact frame's id in the sync bookkeeping (`uploadedByNumber` from
// sync-state.json). If anything is unmatched, unpersisted, or the project is
// empty, it is treated as NOT backed up so its originals are never removed.

export default function isProjectFullyBackedUp({ frames, uploadedByNumber }) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return false;
  }

  if (!uploadedByNumber || typeof uploadedByNumber !== "object") {
    return false;
  }

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frameRecord = frames[frameIndex];

    if (!frameRecord?.id || !frameRecord.originalStorageKey) {
      // A frame with no id or no persisted original cannot have been uploaded.
      return false;
    }

    const frameNumberKey = String(frameIndex + 1);

    if (uploadedByNumber[frameNumberKey] !== frameRecord.id) {
      // This position was never uploaded, or holds a different frame's image.
      return false;
    }
  }

  return true;
}
