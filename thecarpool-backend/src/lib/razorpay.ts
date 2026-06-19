import Razorpay from 'razorpay';
import * as crypto from 'crypto';

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
 * RazorpayX UPI payout: contact → fund_account → payout. Returns the payout id.
 * Only call when isRazorpayXConfigured(). `amount` is in rupees.
 */
export async function createUpiPayout(opts: {
  name: string; upiVpa: string; amountRupees: number; referenceId: string;
}): Promise<{ payout_id: string; status: string }> {
  const base = 'https://api.razorpay.com/v1';

  const contactRes = await fetch(`${base}/contacts`, {
    method: 'POST', headers: razorpayXHeaders(),
    body: JSON.stringify({ name: opts.name, type: 'vendor', reference_id: opts.referenceId }),
  });
  if (!contactRes.ok) throw new Error(`RazorpayX contact ${contactRes.status}`);
  const contact: any = await contactRes.json();

  const faRes = await fetch(`${base}/fund_accounts`, {
    method: 'POST', headers: razorpayXHeaders(),
    body: JSON.stringify({ contact_id: contact.id, account_type: 'vpa', vpa: { address: opts.upiVpa } }),
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
      mode: 'UPI',
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
