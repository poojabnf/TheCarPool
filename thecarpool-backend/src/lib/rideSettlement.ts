/**
 * Paying out a completed ride.
 *
 * This used to run inline the moment a driver marked a ride COMPLETED. It now
 * runs from a scheduled sweep once the settlement hold has elapsed with no
 * dispute, so a wrongly-completed ride can still be stopped before the money
 * moves. The money rules themselves are unchanged — only when they run is.
 *
 * Per-rider outcome depends ONLY on whether the driver verified that rider's
 * boarding OTP:
 *   verified   → the driver receives 100% of that rider's fare.
 *   unverified → treated as a no-show: the rider gets most of it back, the
 *                driver a small share for turning up, the platform the rest.
 * The insurance premium is never part of the driver payout — it is held for
 * the insurer, and refunded to the rider on a no-show.
 */
import { db } from './firestore';
import { defaultCurrency } from './config';
import { noShowOutcome } from './fees';
import { planPayout, maskPayoutMethod } from './payouts';
import { isSettlementDue } from './settlement';
import { releaseTransfer } from './route';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface SettleOutcome {
  paid: number;
  no_shows: number;
  driver_credited: number;
  skipped: number;
}

/**
 * Settle every booking on a ride whose hold has matured.
 *
 * Bookings that are disputed, not held, or not yet due are skipped and left
 * for a later sweep — the decision is re-checked INSIDE the transaction, so a
 * dispute raised between the query and the write still wins.
 */
export async function settleDueBookingsForRide(
  rideId: string,
  driverUid: string,
  log?: { error: (...a: any[]) => void; info?: (...a: any[]) => void }
): Promise<SettleOutcome> {
  const rideRef = db.collection('rides').doc(rideId);
  const rideSnap = await rideRef.get();
  const ride = rideSnap.exists ? rideSnap.data()! : null;
  if (!ride) return { paid: 0, no_shows: 0, driver_credited: 0, skipped: 0 };

  const bookingsSnap = await db.collection('bookings')
    .where('ride_id', '==', rideId)
    .where('escrow_status', '==', 'HELD')
    .get();
  if (bookingsSnap.empty) return { paid: 0, no_shows: 0, driver_credited: 0, skipped: 0 };

  const driverWalletRef = db.collection('wallets').doc(driverUid);
  const settledAt = new Date().toISOString();
  // Read outside the transaction: it only decides routing, and Firestore
  // requires all reads before writes inside one.
  const driverDoc = await db.collection('users').doc(driverUid).get();
  const driverPayoutMethod = driverDoc.data()?.payout_method ?? null;

  return db.runTransaction(async (tx) => {
    const bookingDocs = await Promise.all(bookingsSnap.docs.map((d) => tx.get(d.ref)));

    // Rider wallets we may need to refund, de-duplicated.
    const riderRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const doc of bookingDocs) {
      if (!doc.exists || !isSettlementDue(doc.data() as any)) continue;
      if (doc.data()?.boarding_verified === true) continue;
      const rid = String(doc.data()?.rider_id);
      if (rid && !riderRefs.has(rid)) riderRefs.set(rid, db.collection('wallets').doc(rid));
    }
    const driverWalletDoc = await tx.get(driverWalletRef);
    const riderWalletDocs = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const [rid, ref] of riderRefs) riderWalletDocs.set(rid, await tx.get(ref));

    let driverTotal = 0;
    let paidCount = 0;
    let noShowCount = 0;
    let skipped = 0;
    const riderCredits = new Map<string, number>();
    const bookingWrites: { ref: FirebaseFirestore.DocumentReference; data: any }[] = [];
    // Route transfers to release AFTER the transaction commits — an outbound
    // API call inside a Firestore transaction would be retried with it, and
    // releasing the same transfer twice is not something to risk.
    const routeReleases: { transferId: string; bookingId: string }[] = [];

    for (const doc of bookingDocs) {
      // Re-checked under the transaction: a dispute or cancellation between the
      // query and here must still block the payout.
      if (!doc.exists || !isSettlementDue(doc.data() as any)) { skipped += 1; continue; }
      const b = doc.data()!;
      const fare = Number(b.fare_amount ?? Number(ride.price_split || 0) * Number(b.seats_booked || 1));
      const premium = Number(b.insurance_premium || 0);

      if (b.boarding_verified === true) {
        paidCount += 1;
        // A Route transfer already holds this driver's share at Razorpay, so
        // releasing it IS the payout — crediting the wallet as well would pay
        // twice. Only bookings without a transfer add to the wallet total.
        if (!b.route_transfer_id) driverTotal += fare;
        else routeReleases.push({ transferId: String(b.route_transfer_id), bookingId: doc.id });

        bookingWrites.push({
          ref: doc.ref,
          data: {
            escrow_status: 'SETTLED',
            payment_status: 'RELEASED',
            settled_amount: fare,
            driver_payout: fare,
            insurance_retained: premium,
            settled_at: settledAt,
            settled_via: b.route_transfer_id ? 'ROUTE' : 'WALLET',
          },
        });
      } else {
        const ns = noShowOutcome(fare, premium);
        const rid = String(b.rider_id);
        driverTotal += ns.driver_share;
        noShowCount += 1;
        riderCredits.set(rid, (riderCredits.get(rid) || 0) + ns.refund + ns.insurance_refund);
        bookingWrites.push({
          ref: doc.ref,
          data: {
            escrow_status: 'SETTLED',
            payment_status: 'NO_SHOW',
            no_show: true,
            settled_amount: ns.driver_share,
            driver_payout: ns.driver_share,
            rider_refund: ns.refund + ns.insurance_refund,
            platform_share: ns.platform_share,
            settled_at: settledAt,
          },
        });
      }
    }

    if (bookingWrites.length === 0) {
      return { paid: 0, no_shows: 0, driver_credited: 0, skipped, routeReleases: [] };
    }

    for (const w of bookingWrites) tx.update(w.ref, w.data);
    tx.update(rideRef, { escrow_settled: true, settled_at: settledAt });

    if (driverTotal > 0) {
      const cur = driverWalletDoc.exists
        ? driverWalletDoc.data()!
        : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };

      // Earnings land in the wallet first — it is the single source of truth
      // for what the driver is owed. With payout details on file a transfer is
      // queued; without them the balance simply stays spendable.
      const plan = planPayout({ method: driverPayoutMethod, completedAt: new Date(settledAt) });

      tx.set(driverWalletRef, {
        ...cur,
        available_wallet_balance: round2((cur.available_wallet_balance || 0) + driverTotal),
        withdrawable_after: null,
      }, { merge: true });

      if (plan.destination === 'BANK') {
        // Queued rather than sent inline: an irreversible transfer inside a
        // transaction has no safe failure mode.
        tx.set(db.collection('scheduled_payouts').doc(`${rideId}_${driverUid}`), {
          ride_id: rideId,
          driver_uid: driverUid,
          amount: driverTotal,
          payout_method: driverPayoutMethod,
          destination: maskPayoutMethod(driverPayoutMethod),
          due_at: plan.due_at,
          status: 'PENDING',
          created_at: settledAt,
        });
      }
    }

    for (const [rid, amount] of riderCredits) {
      if (amount <= 0) continue;
      const ref = riderRefs.get(rid)!;
      const doc = riderWalletDocs.get(rid)!;
      const cur = doc.exists
        ? doc.data()!
        : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };
      tx.set(ref, {
        ...cur,
        available_wallet_balance: round2((cur.available_wallet_balance || 0) + amount),
      }, { merge: true });
    }

    return { paid: paidCount, no_shows: noShowCount, driver_credited: round2(driverTotal), skipped, routeReleases };
  }).then(async (outcome) => {
    // Committed. Release the Route holds now, outside the transaction: each is
    // an outbound API call, and Firestore retries a transaction body — which
    // would repeat the release.
    for (const r of outcome.routeReleases ?? []) {
      try {
        await releaseTransfer(r.transferId);
      } catch (err) {
        // The booking is already SETTLED, so nothing retries this on its own.
        // Log loudly: the driver is owed money that is still sitting on hold
        // at Razorpay and needs releasing by hand.
        log?.error(
          { err, transfer_id: r.transferId, booking_id: r.bookingId },
          'Route transfer release FAILED after settlement - driver money still held'
        );
      }
    }
    const { routeReleases: _released, ...rest } = outcome;
    return rest as SettleOutcome;
  }).catch((err) => {
    log?.error({ err, ride_id: rideId }, 'Ride settlement failed');
    return { paid: 0, no_shows: 0, driver_credited: 0, skipped: 0 };
  });
}
