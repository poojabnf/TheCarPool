import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { PayoutMethod, validatePayoutMethod } from './payouts';

// Razorpay client, lazily initialised from environment variables so the app
// still boots (with payments disabled) when keys aren't configured locally.
let client: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (client) return client;

  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error('Razorpay is not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }

  client = new Razorpay({ key_id, key_secret });
  return client;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function isRazorpayXConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAYX_ACCOUNT_NUMBER &&
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET
  );
}

function razorpayXHeaders() {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
}

/**
 * RazorpayX payout: contact → fund_account → payout. Returns the payout id.
 * Only call when isRazorpayXConfigured(). `amountRupees` is in rupees.
 *
 * Handles both destinations a driver can save. UPI goes out over UPI; a bank
 * account goes out over IMPS, which is the transfer mode that actually settles
 * in minutes rather than by the next working day.
 */
export async function createPayout(opts: {
  method: PayoutMethod; amountRupees: number; referenceId: string; fallbackName?: string;
}): Promise<{ payout_id: string; status: string }> {
  const base = 'https://api.razorpay.com/v1';
  const { method } = opts;

  const check = validatePayoutMethod(method);
  if (!check.valid) throw new Error(`Unusable payout method: ${check.reason}`);

  const name = String(method.name || opts.fallbackName || 'TheCarPool driver').trim();

  const contactRes = await fetch(`${base}/contacts`, {
    method: 'POST', headers: razorpayXHeaders(),
    body: JSON.stringify({ name, type: 'vendor', reference_id: opts.referenceId }),
  });
  if (!contactRes.ok) throw new Error(`RazorpayX contact ${contactRes.status}`);
  const contact: any = await contactRes.json();

  const fundAccountBody = method.type === 'VPA'
    ? { contact_id: contact.id, account_type: 'vpa', vpa: { address: String(method.vpa) } }
    : {
        contact_id: contact.id,
        account_type: 'bank_account',
        bank_account: {
          name,
          ifsc: String(method.ifsc).toUpperCase(),
          account_number: String(method.account_number),
        },
      };

  const faRes = await fetch(`${base}/fund_accounts`, {
    method: 'POST', headers: razorpayXHeaders(),
    body: JSON.stringify(fundAccountBody),
  });
  if (!faRes.ok) throw new Error(`RazorpayX fund_account ${faRes.status}`);
  const fundAccount: any = await faRes.json();

  const payoutRes = await fetch(`${base}/payouts`, {
    method: 'POST', headers: razorpayXHeaders(),
    body: JSON.stringify({
      account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
      fund_account_id: fundAccount.id,
      amount: Math.round(opts.amountRupees * 100),
      currency: 'INR',
      mode: method.type === 'VPA' ? 'UPI' : 'IMPS',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: opts.referenceId,
    }),
  });
  if (!payoutRes.ok) throw new Error(`RazorpayX payout ${payoutRes.status}`);
  const payout: any = await payoutRes.json();
  return { payout_id: payout.id, status: payout.status };
}

/**
 * Refund a captured payment back to the rider's original payment method.
 *
 * Used when money was taken but the seat was never confirmed — the rider never
 * had a booking, so parking the money in a platform wallet would be wrong. A
 * cancellation of an already-confirmed booking refunds to the wallet instead.
 *
 * `amountRupees` omitted refunds the payment in full. Idempotent via
 * `referenceId` (Razorpay rejects a duplicate idempotency key).
 */
export async function refundPaymentToSource(opts: {
  paymentId: string;
  amountRupees?: number;
  referenceId: string;
  notes?: Record<string, string>;
}): Promise<{ refund_id: string; status: string }> {
  const body: any = { speed: 'normal', notes: opts.notes || {} };
  if (opts.amountRupees != null) {
    body.amount = Math.round(opts.amountRupees * 100);
  }
  const res = await fetch(`https://api.razorpay.com/v1/payments/${opts.paymentId}/refund`, {
    method: 'POST',
    headers: {
      ...razorpayXHeaders(),
      'X-Razorpay-Idempotency': opts.referenceId,
    },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) {
    throw new Error(`Razorpay refund ${res.status}: ${data?.error?.description || 'unknown error'}`);
  }
  return { refund_id: data.id, status: data.status };
}

/**
 * Verify the signature Razorpay sends after checkout
 * (razorpay_order_id|razorpay_payment_id signed with the key secret).
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verify a Razorpay webhook payload against the configured webhook secret.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
