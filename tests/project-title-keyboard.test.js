import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_TITLE_KEYBOARD_KEYS,
  applyProjectTitleKeyboardKey,
  createInactiveProjectTitleEditorState,
  createProjectTitleEditorState,
  moveProjectTitleKeyboardSelection,
} from "../helpers/project-title-keyboard.js";

test("createProjectTitleEditorState starts active with the current title", () => {
  assert.deepEqual(createProjectTitleEditorState({ title: "Project 1" }), {
    isActive: true,
    draftTitle: "Project 1",
    selectedKeyIndex: 0,
  });

  assert.deepEqual(createInactiveProjectTitleEditorState(), {
    isActive: false,
    draftTitle: "",
    selectedKeyIndex: 0,
  });
});

test("moveProjectTitleKeyboardSelection wraps across the key list", () => {
  assert.equal(moveProjectTitleKeyboardSelection({
    selectedKeyIndex: 0,
    offset: -1,
    keyCount: 4,
  }), 3);

  assert.equal(moveProjectTitleKeyboardSelection({
    selectedKeyIndex: 3,
    offset: 1,
    keyCount: 4,
  }), 0);
});

test("applyProjectTitleKeyboardKey appends characters up to the maximum length", () => {
  const result = applyProjectTitleKeyboardKey({
    draftTitle: "AB",
    key: {
      type: "character",
      label: "C",
      value: "C",
    },
    maximumLength: 2,
  });

  assert.deepEqual(result, {
    draftTitle: "AB",
    action: "edit",
  });
});

test("applyProjectTitleKeyboardKey deletes one character", () => {
  assert.deepEqual(applyProjectTitleKeyboardKey({
    draftTitle: "Project",
    key: {
      type: "backspace",
      label: "Del",
    },
  }), {
    draftTitle: "Projec",
    action: "edit",
  });
});

test("applyProjectTitleKeyboardKey saves non-empty trimmed titles", () => {
  assert.deepEqual(applyProjectTitleKeyboardKey({
    draftTitle: "  My Movie  ",
    key: PROJECT_TITLE_KEYBOARD_KEYS.find((keyboardKey) => keyboardKey.type === "save"),
  }), {
    draftTitle: "  My Movie  ",
    titleToSave: "My Movie",
    action: "save",
  });
});

test("applyProjectTitleKeyboardKey ignores empty saves", () => {
  assert.deepEqual(applyProjectTitleKeyboardKey({
    draftTitle: "   ",
    key: PROJECT_TITLE_KEYBOARD_KEYS.find((keyboardKey) => keyboardKey.type === "save"),
  }), {
    draftTitle: "   ",
    titleToSave: "",
    action: "none",
  });
});

test("applyProjectTitleKeyboardKey cancels title editing", () => {
  assert.deepEqual(applyProjectTitleKeyboardKey({
    draftTitle: "Project",
    key: PROJECT_TITLE_KEYBOARD_KEYS.find((keyboardKey) => keyboardKey.type === "cancel"),
  }), {
    draftTitle: "Project",
    action: "cancel",
  });
});
