import assert from "node:assert/strict";
import test from "node:test";

import computeLayout from "../helpers/compute-layout.js";

test("computeLayout fits a 16 by 9 surface inside a wide viewport", () => {
  const layout = computeLayout({ viewportWidth: 1920, viewportHeight: 1080 });

  assert.deepEqual(layout, {
    width: 1920,
    height: 1080,
    previewWidth: 1574,
    previewHeight: 864,
    controlsWidth: 346,
    timelineHeight: 216,
  });
});

test("computeLayout fits a 16 by 9 surface inside a tall viewport", () => {
  const layout = computeLayout({ viewportWidth: 800, viewportHeight: 1200 });

  assert.equal(layout.width, 800);
  assert.equal(layout.height, 450);
  assert.equal(layout.controlsWidth, 144);
  assert.equal(layout.timelineHeight, 90);
});
