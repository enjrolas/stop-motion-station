import assert from "node:assert/strict";
import test from "node:test";

import {
  GAMEPAD_ACTIONS,
  GAMEPAD_BUTTONS,
  getGamepadActionForButton,
  isGamepadButtonPressed,
  isMappedGamepadButton,
} from "../helpers/gamepad-controls.js";

test("getGamepadActionForButton maps arcade buttons to semantic actions", () => {
  assert.equal(getGamepadActionForButton(GAMEPAD_BUTTONS.back), GAMEPAD_ACTIONS.back);
  assert.equal(getGamepadActionForButton(GAMEPAD_BUTTONS.play), GAMEPAD_ACTIONS.play);
  assert.equal(getGamepadActionForButton(GAMEPAD_BUTTONS.previous), GAMEPAD_ACTIONS.previous);
  assert.equal(getGamepadActionForButton(GAMEPAD_BUTTONS.next), GAMEPAD_ACTIONS.next);
  assert.equal(getGamepadActionForButton(GAMEPAD_BUTTONS.delete), GAMEPAD_ACTIONS.delete);
  assert.equal(getGamepadActionForButton(GAMEPAD_BUTTONS.capture), GAMEPAD_ACTIONS.capture);
});

test("isMappedGamepadButton only accepts configured generic joystick buttons", () => {
  assert.equal(isMappedGamepadButton(0), true);
  assert.equal(isMappedGamepadButton(5), true);
  assert.equal(isMappedGamepadButton(6), false);
});

test("isGamepadButtonPressed accepts browser pressed state or analog value", () => {
  assert.equal(isGamepadButtonPressed({ pressed: true, value: 0 }), true);
  assert.equal(isGamepadButtonPressed({ pressed: false, value: 0.6 }), true);
  assert.equal(isGamepadButtonPressed({ pressed: false, value: 0.4 }), false);
  assert.equal(isGamepadButtonPressed(null), false);
});
