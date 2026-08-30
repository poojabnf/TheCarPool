/**
 * Multi-channel delivery for ride messages.
 *
 * One call site, three channels. Push works today and costs nothing; SMS and
 * WhatsApp light up the moment their credentials exist, with no change at the
 * call sites.
 *
 * Why they are not on yet — these are account problems, not code problems:
 *   - SMS to Indian numbers requires DLT registration under the TRAI mandate:
 *     the sender id AND every template must be registered with the regulator
 *     before a single A2P message will deliver.
 *   - WhatsApp business-initiated messages require a WhatsApp Business
 *     Account, Meta business verification, and pre-approved templates.
 *
 * Both also bill per message, so they stay off until deliberately configured.
 * Every channel is best-effort and independent: a WhatsApp failure must never
 * stop the push, and no notification failure may ever fail the booking that
 * triggered it.
 */
import { sendPushToUser } from './fcm';
import { BuiltMessage } from './rideMessages';
import { db } from './firestore';

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_SMS_FROM
  );
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

/** Which channels are live right now — surfaced so ops can see it at a glance. */
export function activeChannels(): string[] {
  const channels = ['push'];
  if (isSmsConfigured()) channels.push('sms');
  if (isWhatsAppConfigured()) channels.push('whatsapp');
  return channels;
}

async function twilioSend(to: string, body: string, from: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Twilio ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export interface NotifyTarget {
  uid: string;
  /** E.164. Required for SMS/WhatsApp; push works without it. */
  phone?: string | null;
}

export interface NotifyResult {
  push: boolean;
  sms: boolean;
  whatsapp: boolean;
}

/**
 * Deliver one message to one person across every configured channel.
 *
 * Never throws. Returns which channels actually succeeded so callers can log
 * it; nothing downstream should branch on the result, because a notification
 * is not part of the transaction that produced it.
 */
export async function notifyUser(
  target: NotifyTarget,
  message: BuiltMessage,
  data?: Record<string, string>,
  log?: { error: (...args: any[]) => void }
): Promise<NotifyResult> {
  const result: NotifyResult = { push: false, sms: false, whatsapp: false };

  // 1. Always record in user's in-app Notification Center (even if push permissions are disabled)
  try {
    if (target.uid) {
      await db.collection('notifications').add({
        user_id: target.uid,
        title: message.title,
        body: message.body,
        data: data || {},
        type: data?.type || 'GENERAL',
        ride_id: data?.ride_id || null,
        booking_id: data?.booking_id || null,
        read: false,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    log?.error({ err, uid: target.uid }, 'Failed to persist in-app notification inbox item');
  }

  // 2. Dispatch push notification via FCM
  try {
    await sendPushToUser(target.uid, message.title, message.body, data);
    result.push = true;
  } catch (err) {
    log?.error({ err, uid: target.uid }, 'Push notification failed');
  }

  const phone = target.phone?.trim();
  if (!phone) return result;

  // SMS carries the title too — unlike push, there is no separate heading, so
  // dropping it would lose the "what is this about" line entirely.
  const smsBody = `${message.title}\n${message.body}`;

  if (isSmsConfigured()) {
    try {
      await twilioSend(phone, smsBody, process.env.TWILIO_SMS_FROM as string);
      result.sms = true;
    } catch (err) {
      log?.error({ err, uid: target.uid }, 'SMS notification failed');
    }
  }

  if (isWhatsAppConfigured()) {
    try {
      await twilioSend(
        `whatsapp:${phone}`,
        smsBody,
        `whatsapp:${(process.env.TWILIO_WHATSAPP_FROM as string).replace(/^whatsapp:/, '')}`
      );
      result.whatsapp = true;
    } catch (err) {
      log?.error({ err, uid: target.uid }, 'WhatsApp notification failed');
    }
  }

  return result;
}
