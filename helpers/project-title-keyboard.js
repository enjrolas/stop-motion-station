const letterKeys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((character) => ({
  type: "character",
  label: character,
  value: character,
}));

const numberKeys = "0123456789".split("").map((character) => ({
  type: "character",
  label: character,
  value: character,
}));

export const PROJECT_TITLE_MAXIMUM_LENGTH = 48;

export const PROJECT_TITLE_KEYBOARD_KEYS = Object.freeze([
  ...letterKeys,
  ...numberKeys,
  {
    type: "character",
    label: "Space",
    value: " ",
  },
  {
    type: "backspace",
    label: "Del",
  },
  {
    type: "save",
    label: "Done",
  },
  {
    type: "cancel",
    label: "Cancel",
  },
]);

export function createProjectTitleEditorState({ title }) {
  return {
    isActive: true,
    draftTitle: title,
    selectedKeyIndex: 0,
  };
}

export function createInactiveProjectTitleEditorState() {
  return {
    isActive: false,
    draftTitle: "",
    selectedKeyIndex: 0,
  };
}

export function moveProjectTitleKeyboardSelection({
  selectedKeyIndex,
  offset,
  keyCount = PROJECT_TITLE_KEYBOARD_KEYS.length,
}) {
  if (keyCount < 1) {
    return 0;
  }

  return ((selectedKeyIndex + offset) % keyCount + keyCount) % keyCount;
}

export function applyProjectTitleKeyboardKey({
  draftTitle,
  key,
  maximumLength = PROJECT_TITLE_MAXIMUM_LENGTH,
}) {
  if (!key) {
    return {
      draftTitle,
      action: "none",
    };
  }

  if (key.type === "character") {
    return {
      draftTitle: `${draftTitle}${key.value}`.slice(0, maximumLength),
      action: "edit",
    };
  }

  if (key.type === "backspace") {
    return {
      draftTitle: draftTitle.slice(0, -1),
      action: "edit",
    };
  }

  if (key.type === "save") {
    const trimmedTitle = draftTitle.trim();

    return {
      draftTitle,
      titleToSave: trimmedTitle,
      action: trimmedTitle ? "save" : "none",
    };
  }

  if (key.type === "cancel") {
    return {
      draftTitle,
      action: "cancel",
    };
  }

  return {
    draftTitle,
    action: "none",
  };
}
