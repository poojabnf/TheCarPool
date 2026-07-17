import React from 'react';
import { TouchableOpacity, TouchableOpacityProps, GestureResponderEvent } from 'react-native';
import * as haptics from '../services/haptics';

export type HapticStyle = 'tap' | 'press' | 'success' | 'warning' | 'error';

interface HapticPressableProps extends TouchableOpacityProps {
  /** Which haptic to fire on press. Defaults to a light tap. */
  haptic?: HapticStyle;
}

/**
 * Drop-in TouchableOpacity that fires haptic feedback on press.
 * Usage: `<HapticPressable haptic="press" onPress={...}>` — same props as
 * TouchableOpacity, so existing styles/activeOpacity carry over unchanged.
 */
export default function HapticPressable({ haptic = 'tap', onPress, ...rest }: HapticPressableProps) {
  const handlePress = (e: GestureResponderEvent) => {
    haptics[haptic]();
    onPress?.(e);
  };
  return <TouchableOpacity {...rest} onPress={handlePress} />;
}
