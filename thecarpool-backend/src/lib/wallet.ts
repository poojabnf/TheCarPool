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

  if (existing?.wallet_credited === true || existing?.refunded_to_source === true) {
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

    const p = payDoc.exists ? payDoc.data()! : null;
    // Already applied, funded a booking, or went back to the card -- in every
    // case the money is accounted for and crediting it again would mint it.
    if (p && (p.wallet_credited === true || Boolean(p.consumed_by_booking) || p.refunded_to_source === true)) {
      return { credited: false };
    }

    const cur = walletDoc.exists
      ? walletDoc.data()!
      : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };

    tx.set(
      walletRef,
      // A top-up only pays for rides; it never becomes withdrawable cash.
      { ...cur, ...creditRideOnly(cur, amount) },
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


/**
 * Put ride payments that never became a booking into the rider's wallet.
 *
 * The webhook no longer credits a booking payment on arrival -- it raced the
 * app's own booking call, and when it won the rider was paid twice (see
 * payments.ts). But it was also the safety net for a rider whose app died
 * between paying and booking. This keeps the net: a payment still unclaimed
 * after a grace period far longer than any real checkout goes to the wallet,
 * where the rider can see it and spend it.
 *
 * Safe against a booking arriving at the same moment: creditWalletForPayment
 * and the booking claim both run in transactions on the same payment document
 * and each refuses what the other has taken.
 */
export async function creditOrphanedBookingPayments(
  log?: { info: Function; error: Function },
  graceMs = 20 * 60 * 1000
): Promise<{ scanned: number; credited: number }> {
  const snap = await db.collection('payments')
    .where('awaiting_booking', '==', true)
    .limit(100)
    .get();
  const cutoff = Date.now() - graceMs;
  let credited = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const at = Date.parse(d.captured_at || '');
    if (Number.isFinite(at) && at > cutoff) continue; // still within checkout
    try {
      if (d.user_id && !d.consumed_by_booking && !d.wallet_credited && !d.refunded_to_source) {
        const r = await creditWalletForPayment({
          paymentId: doc.id,
          orderId: d.order_id ?? null,
          uid: String(d.user_id),
          amountRupees: Number(d.amount),
        });
        if (r.credited) {
          credited += 1;
          log?.info({ payment_id: doc.id, uid: d.user_id }, 'Orphaned ride payment credited to wallet');
        }
      }
      await doc.ref.set({ awaiting_booking: false }, { merge: true });
    } catch (err) {
      log?.error({ err, payment_id: doc.id }, 'Could not settle orphaned ride payment');
    }
  }
  return { scanned: snap.size, credited };
}

/**
 * Wallet money comes in two kinds. Ride earnings (and refunds of failed
 * payouts) may leave the platform; card top-ups and promo credits (referral
 * bonuses) may only pay for rides. `withdrawable_balance` tracks the first
 * kind and is always <= `available_wallet_balance`.
 *
 * A wallet written before the field existed has no `withdrawable_balance`; it
 * is treated as fully withdrawable so existing drivers are not locked out.
 */
type WalletLike = { available_wallet_balance?: number; withdrawable_balance?: number } | undefined;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function withdrawableOf(w: WalletLike): number {
  const available = Number(w?.available_wallet_balance || 0);
  if (w?.withdrawable_balance == null) return available;
  return Math.max(0, Math.min(available, Number(w.withdrawable_balance)));
}

/** Patch that credits money the user may later withdraw (earnings). */
export function creditWithdrawable(w: WalletLike, amount: number) {
  return {
    available_wallet_balance: r2(Number(w?.available_wallet_balance || 0) + amount),
    withdrawable_balance: r2(withdrawableOf(w) + amount),
  };
}

/** Patch that credits ride-only money (top-ups, promo, ride refunds). */
export function creditRideOnly(w: WalletLike, amount: number) {
  return {
    available_wallet_balance: r2(Number(w?.available_wallet_balance || 0) + amount),
    withdrawable_balance: withdrawableOf(w),
  };
}

/**
 * Patch that debits the wallet. Ride-only money is spent first; a payout
 * (`fromWithdrawable`) must come entirely out of the withdrawable part.
 */
export function debitWallet(w: WalletLike, amount: number, fromWithdrawable = false) {
  const available = r2(Number(w?.available_wallet_balance || 0) - amount);
  const withdrawable = fromWithdrawable
    ? withdrawableOf(w) - amount
    : Math.min(withdrawableOf(w), available);
  return {
    available_wallet_balance: available,
    withdrawable_balance: r2(Math.max(0, withdrawable)),
  };
}
