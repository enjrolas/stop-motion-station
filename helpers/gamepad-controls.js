export const GAMEPAD_ACTIONS = Object.freeze({
  back: "back",
  play: "play",
  previous: "previous",
  next: "next",
  delete: "delete",
  capture: "capture",
});

export const GAMEPAD_BUTTONS = Object.freeze({
  back: 0,
  previous: 1,
  next: 2,
  capture: 3,
  delete: 4,
  play: 5,
});

const gamepadActionByButtonIndex = new Map([
  [GAMEPAD_BUTTONS.back, GAMEPAD_ACTIONS.back],
  [GAMEPAD_BUTTONS.play, GAMEPAD_ACTIONS.play],
  [GAMEPAD_BUTTONS.previous, GAMEPAD_ACTIONS.previous],
  [GAMEPAD_BUTTONS.next, GAMEPAD_ACTIONS.next],
  [GAMEPAD_BUTTONS.delete, GAMEPAD_ACTIONS.delete],
  [GAMEPAD_BUTTONS.capture, GAMEPAD_ACTIONS.capture],
]);

export function getGamepadActionForButton(buttonIndex) {
  return gamepadActionByButtonIndex.get(buttonIndex) ?? null;
}

export function isMappedGamepadButton(buttonIndex) {
  return gamepadActionByButtonIndex.has(buttonIndex);
}

export function isGamepadButtonPressed(gamepadButton) {
  return Boolean(gamepadButton?.pressed || gamepadButton?.value >= 0.5);
}
