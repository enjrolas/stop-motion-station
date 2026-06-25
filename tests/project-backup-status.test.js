import assert from "node:assert/strict";
import test from "node:test";

import isProjectFullyBackedUp from "../helpers/project-backup-status.js";

function frame(id) {
  return { id, originalStorageKey: `${id}.jpg` };
}

test("a project whose every frame matches its uploaded position is fully backed up", () => {
  const frames = [frame("a"), frame("b"), frame("c")];
  const uploadedByNumber = { 1: "a", 2: "b", 3: "c" };

  assert.equal(isProjectFullyBackedUp({ frames, uploadedByNumber }), true);
});

test("an empty project is never treated as backed up", () => {
  assert.equal(isProjectFullyBackedUp({ frames: [], uploadedByNumber: {} }), false);
});

test("a missing uploaded position blocks backup", () => {
  const frames = [frame("a"), frame("b")];
  const uploadedByNumber = { 1: "a" };

  assert.equal(isProjectFullyBackedUp({ frames, uploadedByNumber }), false);
});

test("a position holding a different frame's id blocks backup", () => {
  const frames = [frame("a"), frame("b")];
  const uploadedByNumber = { 1: "a", 2: "stale" };

  assert.equal(isProjectFullyBackedUp({ frames, uploadedByNumber }), false);
});

test("a frame without a persisted original cannot be backed up", () => {
  const frames = [{ id: "a" }, frame("b")];
  const uploadedByNumber = { 1: "a", 2: "b" };

  assert.equal(isProjectFullyBackedUp({ frames, uploadedByNumber }), false);
});

test("a missing or malformed upload map blocks backup", () => {
  const frames = [frame("a")];

  assert.equal(isProjectFullyBackedUp({ frames, uploadedByNumber: null }), false);
  assert.equal(isProjectFullyBackedUp({ frames, uploadedByNumber: undefined }), false);
});

test("extra uploaded positions beyond the current frames do not block backup", () => {
  // Trailing remote frames pending deletion don't endanger re-download of the
  // current frames, so they must not prevent eviction.
  const frames = [frame("a"), frame("b")];
  const uploadedByNumber = { 1: "a", 2: "b", 3: "c-removed-locally" };

  assert.equal(isProjectFullyBackedUp({ frames, uploadedByNumber }), true);
});
