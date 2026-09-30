// A small in-memory stand-in for the parts of Firestore wallet.ts touches.
// Transactions apply their writes on commit, as the real thing does.
const store = new Map<string, any>();
const ref = (path: string) => ({
  path,
  id: path.split('/').pop(),
  set: async (data: any, opts?: { merge?: boolean }) => {
    store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
  },
});
const snap = (path: string) => ({
  exists: store.has(path),
  data: () => store.get(path),
  ref: ref(path),
  id: path.split('/').pop(),
});
jest.mock('../firestore', () => ({
  db: {
    collection: (c: string) => ({
      doc: (id: string) => ref(`${c}/${id}`),
      where: (field: string, _op: string, value: any) => ({
        limit: () => ({
          get: async () => {
            const docs = [...store.keys()]
              .filter((k) => k.startsWith(`${c}/`) && store.get(k)[field] === value)
              .map(snap);
            return { size: docs.length, docs };
          },
        }),
      }),
    }),
    runTransaction: async (fn: (tx: any) => any) => {
      const writes: Array<() => Promise<void>> = [];
      const tx = {
        get: async (r: any) => snap(r.path),
        set: (r: any, d: any, o?: any) => { writes.push(() => r.set(d, o)); },
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  },
}));
jest.mock('../config', () => ({ defaultCurrency: () => 'INR' }));

import { claimPaymentInTransaction, creditWalletForPayment, creditOrphanedBookingPayments } from '../wallet';

const balance = (uid: string) => store.get(`wallets/${uid}`)?.available_wallet_balance ?? 0;
const claim = (paymentId: string, uid = 'rider') => {
  const tx = { set: jest.fn() };
  claimPaymentInTransaction(tx as any, snap(`payments/${paymentId}`) as any, {
    paymentId, uid, bookingId: 'bk_new', amountRupees: 100, requiredRupees: 100,
  });
  return tx;
};

beforeEach(() => store.clear());

describe('a payment that went back to the card', () => {
  // Refunded to source after a failed booking. Spending it again, as wallet
  // credit or as a seat, would mint the money a second time.
  beforeEach(() => store.set('payments/pay_r', { user_id: 'rider', amount: 100, refunded_to_source: true }));

  it('cannot fund a booking', () => {
    expect(() => claim('pay_r')).toThrow('PAYMENT_ALREADY_USED');
  });

  it('cannot be credited to the wallet', async () => {
    const r = await creditWalletForPayment({ paymentId: 'pay_r', uid: 'rider', amountRupees: 100 });
    expect(r.credited).toBe(false);
    expect(balance('rider')).toBe(0);
  });
});

describe('a seat payment the webhook recorded', () => {
  // The webhook now records seat payments instead of crediting them, so the
  // booking call can still claim one that arrives after the webhook.
  it('can still be claimed by its booking', () => {
    store.set('payments/pay_s', { user_id: 'rider', amount: 100, awaiting_booking: true });
    expect(() => claim('pay_s')).not.toThrow();
  });

  it("cannot be claimed by someone else", () => {
    store.set('payments/pay_s', { user_id: 'rider', amount: 100, awaiting_booking: true });
    expect(() => claim('pay_s', 'stranger')).toThrow('PAYMENT_NOT_YOURS');
  });
});

describe('creditOrphanedBookingPayments', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

  it('credits a seat payment no booking claimed, once the grace period is over', async () => {
    store.set('payments/pay_o', { user_id: 'rider', amount: 120, awaiting_booking: true, captured_at: ago(45) });
    const r = await creditOrphanedBookingPayments();
    expect(r.credited).toBe(1);
    expect(balance('rider')).toBe(120);
    expect(store.get('payments/pay_o').awaiting_booking).toBe(false);
  });

  // Checkout may still be in flight; crediting now would race the booking.
  it('leaves a recent payment alone', async () => {
    store.set('payments/pay_o', { user_id: 'rider', amount: 120, awaiting_booking: true, captured_at: ago(2) });
    expect((await creditOrphanedBookingPayments()).credited).toBe(0);
    expect(balance('rider')).toBe(0);
    expect(store.get('payments/pay_o').awaiting_booking).toBe(true);
  });

  it('does not credit a payment that bought a seat', async () => {
    store.set('payments/pay_o', {
      user_id: 'rider', amount: 120, awaiting_booking: true, captured_at: ago(45), consumed_by_booking: 'bk_1',
    });
    expect((await creditOrphanedBookingPayments()).credited).toBe(0);
    expect(balance('rider')).toBe(0);
  });

  it('does not credit a payment already refunded to the card', async () => {
    store.set('payments/pay_o', {
      user_id: 'rider', amount: 120, awaiting_booking: true, captured_at: ago(45), refunded_to_source: true,
    });
    expect((await creditOrphanedBookingPayments()).credited).toBe(0);
    expect(balance('rider')).toBe(0);
  });

  it('credits a payment once, however many times the sweep runs', async () => {
    store.set('payments/pay_o', { user_id: 'rider', amount: 120, awaiting_booking: true, captured_at: ago(45) });
    await creditOrphanedBookingPayments();
    store.set('payments/pay_o', { ...store.get('payments/pay_o'), awaiting_booking: true });
    await creditOrphanedBookingPayments();
    expect(balance('rider')).toBe(120);
  });
});
