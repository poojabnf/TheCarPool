/**
 * Haptic feedback service.
 * ─────────────────────────────────────────────────────
 * Prefers expo-haptics (rich iOS/Android haptic engine — ships with the
 * 1.3.0+ native builds). On older builds that receive this code via OTA the
 * native module doesn't exist, so we degrade to React Native's core
 * Vibration API instead of crashing — hence the guarded require.
 */
import { Vibration, Platform } from 'react-native';

let Haptics: typeof import('expo-haptics') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

function vibrateFallback(ms: number | number[]) {
  try { Vibration.vibrate(ms); } catch { /* simulator without vibrator */ }
}

/** Light tick — button taps, toggles, star ratings. */
export function tap() {
  if (Haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => vibrateFallback(10));
  else vibrateFallback(10);
}

/** Medium thunk — primary CTAs (book, pay, post ride). */
export function press() {
  if (Haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => vibrateFallback(20));
  else vibrateFallback(20);
}

/** Success notification — booking confirmed, ride posted, OTP verified. */
export function success() {
  if (Haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => vibrateFallback([0, 30, 60, 30]));
  else vibrateFallback([0, 30, 60, 30]);
}

/** Warning — cancellations, late-fee prompts, deviation alerts. */
export function warning() {
  if (Haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => vibrateFallback([0, 40, 80, 40]));
  else vibrateFallback([0, 40, 80, 40]);
}

/** Error / SOS — strong, unmistakable. */
export function error() {
  if (Haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => vibrateFallback([0, 60, 100, 60, 100, 60]));
  else vibrateFallback([0, 60, 100, 60, 100, 60]);
}

/** Long SOS pattern — used when an SOS is actually dispatched. */
export function sos() {
  if (Platform.OS === 'android') vibrateFallback([0, 100, 80, 100, 80, 300]);
  else error();
}
