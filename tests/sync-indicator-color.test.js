import assert from "node:assert/strict";
import test from "node:test";

import computeSyncIndicatorColor from "../helpers/sync-indicator-color.js";

const enabled = (overrides = {}) => ({
  enabled: true,
  state: "synced",
  pendingProjectCount: 0,
  ...overrides,
});

test("hidden (null) when sync is disabled or absent", () => {
  assert.equal(computeSyncIndicatorColor({ syncStatus: null, isOnline: true }), null);
  assert.equal(
    computeSyncIndicatorColor({ syncStatus: { enabled: false }, isOnline: true }),
    null,
  );
});

test("blue (offline) whenever there is no connection, regardless of sync state", () => {
  assert.equal(computeSyncIndicatorColor({ syncStatus: enabled(), isOnline: false }), "offline");
  assert.equal(
    computeSyncIndicatorColor({ syncStatus: enabled({ state: "syncing" }), isOnline: false }),
    "offline",
  );
});

test("yellow (syncing) when online and a sync is in progress, pending, or retrying", () => {
  assert.equal(
    computeSyncIndicatorColor({ syncStatus: enabled({ state: "syncing" }), isOnline: true }),
    "syncing",
  );
  assert.equal(
    computeSyncIndicatorColor({ syncStatus: enabled({ state: "idle", pendingProjectCount: 2 }), isOnline: true }),
    "syncing",
  );
  assert.equal(
    computeSyncIndicatorColor({ syncStatus: enabled({ state: "error" }), isOnline: true }),
    "syncing",
  );
});

test("green (synced) when online and everything is synced", () => {
  assert.equal(computeSyncIndicatorColor({ syncStatus: enabled({ state: "synced" }), isOnline: true }), "synced");
  assert.equal(computeSyncIndicatorColor({ syncStatus: enabled({ state: "idle" }), isOnline: true }), "synced");
});
