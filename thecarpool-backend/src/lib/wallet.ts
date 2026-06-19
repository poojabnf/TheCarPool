import { db } from '../server';

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

    if (payDoc.exists && payDoc.data()?.wallet_credited === true) {
      return { credited: false }; // already applied — no-op
    }

    const cur = walletDoc.exists
      ? walletDoc.data()!
      : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };

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
