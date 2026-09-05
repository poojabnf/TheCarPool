import React from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Pressable,
  StyleProp, ViewStyle, TextStyle,
} from 'react-native';
import * as haptics from '../services/haptics';
import type { HapticStyle } from './HapticPressable';
import { c, font, button, darken } from '../theme/tokens';

/**
 * The app's button.
 *
 * Written because there wasn't one. The primary action was 50pt tall on Home,
 * 46pt on a ride card, 54pt on Confirm & Pay and padding-derived on the driver
 * dashboard, in ink, green and the legacy theme's blue respectively. Each was
 * defensible alone; together they read as three different apps.
 *
 * Proportions follow Uber's Base design system, whose button tokens are public
 * in uber/baseweb -- 8pt corner, 36/48/56 heights, 14/16/18 labels. The flat
 * slab: solid fill, no gradient, no shadow, weight carried by colour rather
 * than ornament. A raised button reads as a card you could drag rather than a
 * control you press.
 *
 * Intent is a `variant`, never a colour passed at the call site. That is how
 * the drift started.
 */

export type ButtonVariant =
  /** The one action a screen is asking for. Ink. At most one per view. */
  | 'primary'
  /** Confirming money or motion: book, pay, start, accept. */
  | 'go'
  /** Cancel, decline, SOS. Destructive and deliberate. */
  | 'danger'
  /** Sits beside a primary. Bordered, transparent fill. */
  | 'secondary'
  /** Lowest weight -- a text action with no chrome. */
  | 'ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretches to the container. Full-width is the default for a slab. */
  block?: boolean;
  disabled?: boolean;
  /** Swaps the label for a spinner and blocks presses. */
  loading?: boolean;
  /**
   * Rendered before the label. Pass an element, or a function receiving the
   * resolved colour and size so the icon matches the variant without the
   * caller having to know either.
   */
  icon?: React.ReactNode | ((opts: { color: string; size: number }) => React.ReactNode);
  haptic?: HapticStyle;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

interface Skin { bg: string; fg: string; border?: string }

const SKINS: Record<ButtonVariant, Skin> = {
  primary:   { bg: c.actionPrimary, fg: c.actionPrimaryText },
  go:        { bg: c.go,            fg: c.textInverse },
  danger:    { bg: c.danger,        fg: c.textInverse },
  secondary: { bg: 'transparent',   fg: c.textPrimary, border: c.borderDefault },
  ghost:     { bg: 'transparent',   fg: c.textPrimary },
};

/** Resting fill deepened for the pressed state; see button.pressDarken. */
const PRESSED: Record<ButtonVariant, string> = {
  primary:   darken(SKINS.primary.bg, button.pressDarken),
  go:        darken(SKINS.go.bg, button.pressDarken),
  danger:    darken(SKINS.danger.bg, button.pressDarken),
  secondary: button.pressTint,
  ghost:     button.pressTint,
};

export default function Button({
  label, onPress, variant = 'primary', size = 'md', block = true,
  disabled = false, loading = false, icon, haptic,
  style, labelStyle, accessibilityLabel, testID,
}: ButtonProps) {
  const skin = SKINS[variant];
  const inert = disabled || loading;

  // A destructive action should feel heavier to trigger than a neutral one.
  const resolvedHaptic: HapticStyle =
    haptic ?? (variant === 'danger' ? 'warning' : variant === 'go' ? 'success' : 'press');

  const iconSize = button.iconSize[size];
  const renderedIcon = typeof icon === 'function' ? icon({ color: skin.fg, size: iconSize }) : icon;

  const handlePress = () => {
    haptics[resolvedHaptic]();
    onPress?.();
  };

  return (
    <Pressable
      onPress={inert ? undefined : handlePress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          height: button.height[size],
          paddingHorizontal: button.paddingX[size],
          backgroundColor: pressed && !inert ? PRESSED[variant] : skin.bg,
          alignSelf: block ? 'stretch' : 'flex-start',
        },
        skin.border ? { borderWidth: 1, borderColor: skin.border } : null,
        // Dimmed rather than recoloured: a disabled button keeps its identity,
        // so it stays obvious which action would run once it is available.
        inert ? styles.inert : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={skin.fg} />
      ) : (
        <View style={styles.row}>
          {renderedIcon}
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              { color: skin.fg, fontSize: button.fontSize[size] },
              labelStyle,
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: button.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: button.gap },
  label: {
    // Base specifies weight 500. Uber Move at 500 sets a sturdier line than
    // Manrope does, so semibold keeps the optical weight rather than the
    // nominal number -- matching the drawing, not the spec sheet.
    fontFamily: font.sansSemibold,
    letterSpacing: 0.1,
  },
  inert: { opacity: 0.4 },
});
