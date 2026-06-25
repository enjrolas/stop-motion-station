import assert from "node:assert/strict";
import test from "node:test";

import { parseProjectCreationTimestamp } from "../helpers/project-identifier.js";

test("parses the creation timestamp embedded in a project id", () => {
  assert.equal(
    parseProjectCreationTimestamp("project-1700000000000-9af3c1d2"),
    1700000000000,
  );
});

test("returns the fallback when the id has no parseable timestamp", () => {
  assert.equal(parseProjectCreationTimestamp("weird-id", 42), 42);
  assert.equal(parseProjectCreationTimestamp("project-abc-1234", 42), 42);
  assert.equal(parseProjectCreationTimestamp(null, 42), 42);
  assert.equal(parseProjectCreationTimestamp(undefined, 42), 42);
});

test("fallback defaults to 0", () => {
  assert.equal(parseProjectCreationTimestamp("no-timestamp-here"), 0);
});
