/**
 * Push notification registration.
 * ─────────────────────────────────────────────────────
 * Requests permission, obtains the device's FCM token, and registers it with
 * the backend so the server can target this device.
 *
 * WHY FIREBASE MESSAGING AND NOT expo-notifications' getDevicePushTokenAsync:
 * on iOS that returns the RAW APNs device token — 64 hex characters. The
 * backend sends through firebase-admin, which only accepts FCM registration
 * tokens, and rejected every one of them with "The registration token is not
 * a valid FCM registration token". Every iOS push failed, silently, while
 * Android worked. messaging().getToken() returns an FCM token on both
 * platforms; on iOS Firebase handles the APNs mapping itself.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import messaging from '@react-native-firebase/messaging';
import { apiFetch } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  // Push only works on physical devices.
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  try {
    // iOS will not issue an FCM token until the device has registered with
    // APNs. Without this the first call after a fresh install can return an
    // empty token, and the device then receives nothing until the next
    // launch.
    if (Platform.OS === 'ios' && !messaging().isDeviceRegisteredForRemoteMessages) {
      await messaging().registerDeviceForRemoteMessages();
    }

    const token = await messaging().getToken();
    if (!token) return null;

    // Register the token with the backend (best-effort).
    await apiFetch('/api/users/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Platform.OS }),
    });

    return token;
  } catch {
    return null;
  }
}

/**
 * Keep the registered token current.
 *
 * FCM rotates a token on reinstall, restore-from-backup, and occasionally on
 * its own. Registering only at launch leaves the server holding a dead token
 * until the next cold start, and the user silently stops receiving anything.
 * Returns the unsubscribe function.
 */
export function subscribeToTokenRefresh(): () => void {
  return messaging().onTokenRefresh(async (token) => {
    try {
      await apiFetch('/api/users/push-token', {
        method: 'POST',
        body: JSON.stringify({ token, platform: Platform.OS }),
      });
    } catch { /* best effort — the next launch re-registers anyway */ }
  });
}
