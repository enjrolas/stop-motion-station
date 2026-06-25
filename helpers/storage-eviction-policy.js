// Pure decision logic for reclaiming Origin Private File System space when it
// approaches the browser-granted quota. The service layer supplies a current
// storage estimate plus a list of candidate projects; this module decides
// whether to act and, if so, which projects to offload.
//
// Hysteresis: eviction only triggers once usage crosses a high-water mark, and
// then frees space down to a lower-water mark, so we are not deleting on every
// tick around a single threshold.

export const DEFAULT_HIGH_WATERMARK_RATIO = 0.8;
export const DEFAULT_LOW_WATERMARK_RATIO = 0.6;

// Rough per-original-frame size used to project how much each project would
// free without reading every file. Actual usage is re-measured after eviction.
export const ESTIMATED_ORIGINAL_FRAME_BYTES = 250_000;

export function isStorageOverHighWatermark({
  usageBytes,
  quotaBytes,
  highWatermarkRatio = DEFAULT_HIGH_WATERMARK_RATIO,
}) {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    return false;
  }

  return usageBytes / quotaBytes >= highWatermarkRatio;
}

// Given the current usage and an ordered-agnostic list of candidate projects,
// returns the project ids to evict (oldest first) until projected usage falls
// to or below the low-water mark. Only evictable candidates with reclaimable
// bytes are considered; non-backed-up projects must be passed as
// `isEvictable: false` so they are never selected.
export function selectProjectsToEvict({
  usageBytes,
  quotaBytes,
  highWatermarkRatio = DEFAULT_HIGH_WATERMARK_RATIO,
  lowWatermarkRatio = DEFAULT_LOW_WATERMARK_RATIO,
  candidates,
}) {
  if (!isStorageOverHighWatermark({ usageBytes, quotaBytes, highWatermarkRatio })) {
    return [];
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const targetUsageBytes = quotaBytes * lowWatermarkRatio;

  const eligibleCandidatesOldestFirst = candidates
    .filter((candidate) => candidate?.isEvictable && candidate.reclaimableBytes > 0)
    .sort((firstCandidate, secondCandidate) =>
      firstCandidate.updatedAtMilliseconds - secondCandidate.updatedAtMilliseconds);

  const selectedProjectIds = [];
  let projectedUsageBytes = usageBytes;

  for (const candidate of eligibleCandidatesOldestFirst) {
    if (projectedUsageBytes <= targetUsageBytes) {
      break;
    }

    selectedProjectIds.push(candidate.projectId);
    projectedUsageBytes -= candidate.reclaimableBytes;
  }

  return selectedProjectIds;
}
