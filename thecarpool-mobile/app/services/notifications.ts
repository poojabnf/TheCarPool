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
import { router } from 'expo-router';
import { apiFetch } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Top-level background message handler for FCM
try {
  messaging().setBackgroundMessageHandler(async () => {
    // Processed by native system notification tray
  });
} catch {
  // Already registered or web environment
}

export async function registerForPushNotifications(): Promise<string | null> {
  // Push only works on physical devices.
  if (!Device.isDevice) return null;

  try {
    // 1. Expo Notification Permissions
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    // 2. Firebase Messaging Permissions (required for APNs on iOS)
    if (Platform.OS === 'ios') {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      if (!enabled) return null;
    }

    // 3. Android High-Importance Channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'General Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#16A34A',
        sound: 'default',
        enableLights: true,
        enableVibrate: true,
      });
    }

    // 4. Register iOS device for remote messages
    if (Platform.OS === 'ios' && !messaging().isDeviceRegisteredForRemoteMessages) {
      await messaging().registerDeviceForRemoteMessages();
    }

    // 5. Get FCM Token
    const token = await messaging().getToken();
    if (!token) return null;

    // 6. Register token with backend
    await apiFetch('/api/users/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Platform.OS }),
    });

    return token;
  } catch (err) {
    console.warn('Push notification registration warning:', err);
    return null;
  }
}

export function handleNotificationNavigation(data?: Record<string, any>) {
  if (!data) return;

  const { type, ride_id, booking_id } = data;

  // 1. Driver booking request -> Driver tab Requests subview
  if (type === 'BOOKING_REQUESTED') {
    router.push('/(tabs)/driver?tab=requests');
    return;
  }

  // 2. Rider booking confirmed / OTP / boarding soon / ride completed -> Trip details
  if (ride_id) {
    router.push(`/trip/${ride_id}`);
    return;
  }

  // 3. Fallback for booking specific notifications -> My Trips
  if (booking_id || type === 'RIDER_REQUEST_DECLINED') {
    router.push('/(tabs)/trips');
    return;
  }
}

/**
 * Listen to user tapping on a notification while the app is backgrounded or in foreground.
 */
export function setupNotificationResponseListener(): () => void {
  // Check if app was opened from a quit state via FCM notification
  messaging()
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage?.data) {
        setTimeout(() => handleNotificationNavigation(remoteMessage.data), 800);
      }
    })
    .catch(() => {});

  // App opened from background via FCM notification
  const unsubscribeMessaging = messaging().onNotificationOpenedApp((remoteMessage) => {
    if (remoteMessage?.data) {
      handleNotificationNavigation(remoteMessage.data);
    }
  });

  // User interacted with Expo local/presented notification
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    handleNotificationNavigation(data);
  });

  return () => {
    unsubscribeMessaging();
    subscription.remove();
  };
}

/**
 * Handle foreground notifications and present them as heads-up alerts.
 */
export function setupForegroundNotifications(): () => void {
  return messaging().onMessage(async (remoteMessage) => {
    if (remoteMessage.notification) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: remoteMessage.notification.title || 'TheCarPool',
          body: remoteMessage.notification.body || '',
          data: remoteMessage.data || {},
          sound: 'default',
        },
        trigger: null,
      });
    }
  });
}

/**
 * Keep the registered token current on rotation.
 */
export function subscribeToTokenRefresh(): () => void {
  return messaging().onTokenRefresh(async (token) => {
    try {
      await apiFetch('/api/users/push-token', {
        method: 'POST',
        body: JSON.stringify({ token, platform: Platform.OS }),
      });
    } catch { /* best effort */ }
  });
}

