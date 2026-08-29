import React from 'react';
import { Switch, SwitchProps } from 'react-native';
import * as haptics from '../services/haptics';

/**
 * Drop-in Switch that gives tactile feedback when toggled.
 *
 * Every button in the app went through HapticPressable, but the toggles did
 * not — and a switch is the control where feedback matters most. A button
 * usually navigates or opens something, so the screen confirms the press. A
 * toggle changes a setting in place; without a tick you are relying entirely
 * on noticing a small piece of colour move, which is exactly the thing people
 * miss on a phone in one hand.
 *
 * Deliberately different intensities for on and off: turning something ON is
 * the more consequential direction (women-only rides, approve-each-rider,
 * recurring), so it gets the firmer thunk.
 */
export default function HapticSwitch({ onValueChange, ...rest }: SwitchProps) {
  return (
    <Switch
      {...rest}
      onValueChange={(v) => {
        if (v) haptics.press();
        else haptics.tap();
        onValueChange?.(v);
      }}
    />
  );
}
