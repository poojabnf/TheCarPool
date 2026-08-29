import { db } from './firestore';
import { defaultCurrency } from './config';
import { isAtLeast } from './money';

/**
 * Credit a user's wallet for a captured Razorpay payment, exactly once.
 *
 * Idempotency is enforced via the `payments/{paymentId}` document: the credit
 * and the `wallet_credited` flag are flipped together inside one Firestore
 * transaction, so a replayed `/verify` call and the asynchronous webhook can
 * both invoke this for the same payment without ever double-crediting.
 *
 * `amountRupees` MUST come from Razorpay (the fetched payment entity or the
 * webhook payload) — never from the client — so a caller can't claim a larger
 * amount than they actually paid.
 */
/**
 * Claim a captured Razorpay payment as the funding for a specific booking.
 *
 * This is what makes "no booking without full payment" enforceable. The
 * `payments/{paymentId}` doc is the single claim record: a payment already
 * credited to a wallet, or already consumed by another booking, cannot be
 * reused. Caller MUST have fetched the payment from Razorpay first and passed
 * the real captured amount — never a client-supplied figure.
 *
 * Returns the transaction body so it can be composed inside a larger booking
 * transaction; see `claimPaymentInTransaction` for that form.
 */
export function claimPaymentInTransaction(
  tx: FirebaseFirestore.Transaction,
  payDoc: FirebaseFirestore.DocumentSnapshot,
  opts: { paymentId: string; uid: string; bookingId: string; amountRupees: number; requiredRupees: number }
) {
  const { paymentId, uid, bookingId, amountRupees, requiredRupees } = opts;
  const existing = payDoc.exists ? payDoc.data()! : null;

  if (existing?.wallet_credited === true) {
    throw new Error('PAYMENT_ALREADY_USED');
  }
  if (existing?.consumed_by_booking && existing.consumed_by_booking !== bookingId) {
    throw new Error('PAYMENT_ALREADY_USED');
  }
  if (existing?.user_id && String(existing.user_id) !== String(uid)) {
    throw new Error('PAYMENT_NOT_YOURS');
  }
  // Guard against a partial payment funding a full-price seat.
  // Exact, in paise. The old `+ 0.01` slack existed to absorb float drift
  // but could not tell drift from a genuine shortfall, so it also accepted a
  // payment one paisa short. isAtLeast removes the drift instead.
  if (!isAtLeast(amountRupees, requiredRupees)) {
    throw new Error('PAYMENT_TOO_SMALL');
  }

  tx.set(
    payDoc.ref,
    {
      user_id: uid,
      amount: amountRupees,
      status: 'CAPTURED',
      consumed_by_booking: bookingId,
      consumed_at: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function creditWalletForPayment(opts: {
  paymentId: string;
  orderId?: string | null;
  uid: string;
  amountRupees: number;
}): Promise<{ credited: boolean }> {
  const { paymentId, orderId, uid, amountRupees } = opts;
  const amount = Number(amountRupees);
  if (!uid || !paymentId || !Number.isFinite(amount) || amount <= 0) {
    return { credited: false };
  }

  return db.runTransaction(async (tx) => {
    const payRef = db.collection('payments').doc(paymentId);
    const walletRef = db.collection('wallets').doc(uid);

    // All reads before any writes (Firestore transaction requirement).
    const [payDoc, walletDoc] = await Promise.all([tx.get(payRef), tx.get(walletRef)]);

    if (payDoc.exists && (payDoc.data()?.wallet_credited === true || Boolean(payDoc.data()?.consumed_by_booking))) {
      return { credited: false }; // already applied or directly funded a booking — no-op
    }

    const cur = walletDoc.exists
      ? walletDoc.data()!
      : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };

    tx.set(
      walletRef,
      { ...cur, available_wallet_balance: (cur.available_wallet_balance || 0) + amount },
      { merge: true }
    );
    tx.set(
      payRef,
      {
        user_id: uid,
        order_id: orderId ?? payDoc.data()?.order_id ?? null,
        amount,
        status: 'CAPTURED',
        wallet_credited: true,
        credited_at: new Date().toISOString(),
      },
      { merge: true }
    );

    return { credited: true };
  });
}
