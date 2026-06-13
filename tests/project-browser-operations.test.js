import assert from "node:assert/strict";
import test from "node:test";

import {
  clampSelectionIndex,
  createDefaultProjectTitle,
  createProjectBrowserTileList,
  findBrowserSelectionIndexForProjectId,
  moveProjectBrowserSelectionByDirection,
} from "../helpers/project-browser-operations.js";

test("createProjectBrowserTileList prepends the new project tile", () => {
  const tiles = createProjectBrowserTileList({
    projects: [
      { id: "project-one", title: "Project One", thumbnailImageSource: null, updatedAtMilliseconds: 1 },
    ],
  });

  assert.deepEqual(tiles.map((tile) => tile.type), ["new-project", "project"]);
  assert.equal(tiles[1].projectId, "project-one");
});

test("moveProjectBrowserSelectionByDirection respects the grid and clamps", () => {
  assert.equal(moveProjectBrowserSelectionByDirection({
    selectedIndex: 0,
    tileCount: 6,
    columnCount: 3,
    direction: "down",
  }), 3);

  assert.equal(moveProjectBrowserSelectionByDirection({
    selectedIndex: 5,
    tileCount: 6,
    columnCount: 3,
    direction: "right",
  }), 5);
});

test("clampSelectionIndex handles empty and out-of-range selections", () => {
  assert.equal(clampSelectionIndex({ selectedIndex: 99, tileCount: 3 }), 2);
  assert.equal(clampSelectionIndex({ selectedIndex: -5, tileCount: 3 }), 0);
  assert.equal(clampSelectionIndex({ selectedIndex: 4, tileCount: 0 }), 0);
});

test("findBrowserSelectionIndexForProjectId offsets project indexes because of the new tile", () => {
  assert.equal(findBrowserSelectionIndexForProjectId({
    projects: [{ id: "first" }, { id: "second" }],
    projectId: "second",
  }), 2);

  assert.equal(findBrowserSelectionIndexForProjectId({
    projects: [{ id: "first" }],
    projectId: "missing",
  }), 0);
});

test("createDefaultProjectTitle uses the next project count", () => {
  assert.equal(createDefaultProjectTitle({ projects: [{ id: "first" }, { id: "second" }] }), "Project 3");
});
