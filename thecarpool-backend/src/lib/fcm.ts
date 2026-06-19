/**
 * FCM Push Notification Helper
 * ─────────────────────────────────────────────────────
 * Sends Firebase Cloud Messaging push notifications to user devices.
 * Uses Firebase Admin SDK — device tokens are stored in Firestore
 * under users/{uid}/push_tokens by the /api/users/push-token endpoint.
 *
 * Non-fatal: if no tokens are registered or FCM fails, the error is
 * logged but does not bubble up to the caller.
 */
import * as admin from 'firebase-admin';
import { db } from '../server';

export async function sendPushToUser(
  uid: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return;

    const userData = userDoc.data()!;
    const pushTokensMap: Record<string, { platform: string }> = userData.push_tokens || {};
    const tokens = Object.keys(pushTokensMap);
    if (!tokens.length) return;

    // Send to all registered device tokens for this user
    const messages: admin.messaging.Message[] = tokens.map((token) => ({
      token,
      notification: { title, body },
      data: data || {},
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
      android: {
        priority: 'high' as const,
        notification: { sound: 'default' },
      },
    }));

    const results = await Promise.allSettled(
      messages.map((msg) => admin.messaging().send(msg))
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      console.warn(`FCM: ${failed}/${messages.length} messages failed for uid=${uid}`);
    }
  } catch (err) {
    // Non-fatal — don't break the calling request
    console.error('FCM sendPushToUser error:', err);
  }
}
