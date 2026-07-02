import * as crypto from 'crypto';
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
  isRazorpayConfigured,
  isRazorpayXConfigured,
} from '../lib/razorpay';

const SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';

describe('razorpay signature verification', () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
  });

  test('accepts a valid checkout signature', () => {
    const orderId = 'order_ABC123';
    const paymentId = 'pay_XYZ789';
    const signature = crypto.createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    expect(verifyPaymentSignature(orderId, paymentId, signature)).toBe(true);
  });

  test('rejects a tampered checkout signature', () => {
    const signature = crypto.createHmac('sha256', SECRET).update('order_A|pay_B').digest('hex');
    expect(verifyPaymentSignature('order_A', 'pay_DIFFERENT', signature)).toBe(false);
  });

  test('rejects checkout signature signed with the wrong secret', () => {
    const signature = crypto.createHmac('sha256', 'attacker_secret').update('order_A|pay_B').digest('hex');
    expect(verifyPaymentSignature('order_A', 'pay_B', signature)).toBe(false);
  });

  test('rejects when secret is missing', () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const signature = crypto.createHmac('sha256', SECRET).update('order_A|pay_B').digest('hex');
    expect(verifyPaymentSignature('order_A', 'pay_B', signature)).toBe(false);
  });

  test('accepts a valid webhook signature', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    expect(verifyWebhookSignature(body, signature)).toBe(true);
  });

  test('rejects a webhook signature over a modified body', () => {
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(JSON.stringify({ event: 'payment.captured', amount: 100 }))
      .digest('hex');
    const tampered = JSON.stringify({ event: 'payment.captured', amount: 100000 });
    expect(verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  test('rejects malformed (non-hex / wrong length) webhook signature without throwing', () => {
    expect(verifyWebhookSignature('{}', 'not-a-real-signature')).toBe(false);
  });

  test('configuration flags reflect env state', () => {
    expect(isRazorpayConfigured()).toBe(true);
    expect(isRazorpayXConfigured()).toBe(false);
    process.env.RAZORPAYX_ACCOUNT_NUMBER = '1234567890';
    expect(isRazorpayXConfigured()).toBe(true);
  });
});
