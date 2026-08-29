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
import { db } from './firestore';

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

    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (rejected.length > 0) {
      // Log WHY, not just how many.
      //
      // This previously counted failures and threw the reasons away, so the
      // log read "FCM: 7/7 messages failed" forever while every push in the
      // system was being refused for one fixable reason — the runtime service
      // account was missing roles/firebasemessaging.admin. A count tells you
      // something is broken; only the reason tells you what to do about it.
      const reasons = new Map<string, number>();
      for (const r of rejected) {
        const code = (r.reason as any)?.errorInfo?.code
          ?? (r.reason as any)?.code
          ?? 'unknown';
        reasons.set(code, (reasons.get(code) ?? 0) + 1);
      }
      const summary = [...reasons.entries()].map(([code, n]) => `${code} x${n}`).join(', ');
      console.warn(
        `FCM: ${rejected.length}/${messages.length} messages failed for uid=${uid}: ${summary}`
      );
      // The first full error, once — enough to diagnose without repeating the
      // same stack for every device the user owns.
      console.warn('FCM: first failure detail:', (rejected[0].reason as any)?.message ?? rejected[0].reason);
    }

    // Prune tokens the device has thrown away. Without this a user who
    // reinstalls accumulates dead tokens forever, and every later send does
    // pointless work against them.
    // Indexed off `results`, not `rejected` — the two arrays do not line up
    // once any send succeeds, and tokens[] is parallel to results[].
    const stale: string[] = [];
    results.forEach((r, i) => {
      if (r.status !== 'rejected') return;
      const code = (r.reason as any)?.errorInfo?.code ?? (r.reason as any)?.code;
      // not-registered: the app was uninstalled or the token rotated.
      // invalid-argument: the string is not an FCM token at all — iOS used to
      // register its raw APNs device token here, which FCM will never accept.
      // Neither can start working again, so keep neither.
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-argument'
      ) {
        stale.push(tokens[i]);
      }
    });
    if (stale.length > 0) {
      const removal: Record<string, admin.firestore.FieldValue> = {};
      for (const t of stale) removal[`push_tokens.${t}`] = admin.firestore.FieldValue.delete();
      await db.collection('users').doc(uid).update(removal).catch(() => { /* best effort */ });
    }
  } catch (err) {
    // Non-fatal — don't break the calling request
    console.error('FCM sendPushToUser error:', err);
  }
}
