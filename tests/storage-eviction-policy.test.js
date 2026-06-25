import assert from "node:assert/strict";
import test from "node:test";

import {
  isStorageOverHighWatermark,
  selectProjectsToEvict,
  DEFAULT_HIGH_WATERMARK_RATIO,
  DEFAULT_LOW_WATERMARK_RATIO,
} from "../helpers/storage-eviction-policy.js";

test("high-water mark compares usage ratio against the threshold", () => {
  assert.equal(
    isStorageOverHighWatermark({ usageBytes: 80, quotaBytes: 100 }),
    true,
  );
  assert.equal(
    isStorageOverHighWatermark({ usageBytes: 79, quotaBytes: 100 }),
    false,
  );
});

test("high-water mark is false when the quota is unknown or zero", () => {
  assert.equal(isStorageOverHighWatermark({ usageBytes: 50, quotaBytes: 0 }), false);
  assert.equal(
    isStorageOverHighWatermark({ usageBytes: 50, quotaBytes: undefined }),
    false,
  );
});

test("nothing is evicted while under the high-water mark", () => {
  const selected = selectProjectsToEvict({
    usageBytes: 50,
    quotaBytes: 100,
    candidates: [
      { projectId: "p1", updatedAtMilliseconds: 1, reclaimableBytes: 40, isEvictable: true },
    ],
  });

  assert.deepEqual(selected, []);
});

test("evicts oldest-first only until projected usage reaches the low-water mark", () => {
  const selected = selectProjectsToEvict({
    usageBytes: 90,
    quotaBytes: 100,
    highWatermarkRatio: 0.8,
    lowWatermarkRatio: 0.6,
    candidates: [
      { projectId: "newest", updatedAtMilliseconds: 300, reclaimableBytes: 20, isEvictable: true },
      { projectId: "oldest", updatedAtMilliseconds: 100, reclaimableBytes: 20, isEvictable: true },
      { projectId: "middle", updatedAtMilliseconds: 200, reclaimableBytes: 20, isEvictable: true },
    ],
  });

  // Need to drop from 90 to <=60: evict oldest (->70) then middle (->50). Stop.
  assert.deepEqual(selected, ["oldest", "middle"]);
});

test("non-evictable (not backed up) projects are never selected", () => {
  const selected = selectProjectsToEvict({
    usageBytes: 95,
    quotaBytes: 100,
    lowWatermarkRatio: 0.6,
    candidates: [
      { projectId: "unsynced", updatedAtMilliseconds: 1, reclaimableBytes: 90, isEvictable: false },
      { projectId: "synced", updatedAtMilliseconds: 2, reclaimableBytes: 20, isEvictable: true },
    ],
  });

  assert.deepEqual(selected, ["synced"]);
});

test("candidates with nothing to reclaim are skipped", () => {
  const selected = selectProjectsToEvict({
    usageBytes: 90,
    quotaBytes: 100,
    candidates: [
      { projectId: "empty", updatedAtMilliseconds: 1, reclaimableBytes: 0, isEvictable: true },
      { projectId: "real", updatedAtMilliseconds: 2, reclaimableBytes: 40, isEvictable: true },
    ],
  });

  assert.deepEqual(selected, ["real"]);
});

test("default thresholds are exported for the service layer", () => {
  assert.equal(DEFAULT_HIGH_WATERMARK_RATIO, 0.8);
  assert.equal(DEFAULT_LOW_WATERMARK_RATIO, 0.6);
});
