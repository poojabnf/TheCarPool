/**
 * Closing out rides the driver never finished.
 *
 * A ride only leaves STARTED when its driver marks it COMPLETED, and that is
 * what releases escrow. When they never do, the ride sits in STARTED forever
 * with every rider's fare held behind it -- nobody refunded, nobody paid, and
 * no screen saying why. See rideDeadline for how long is long enough.
 *
 * WHAT "CLOSE" MEANS HERE. It is the action, not a state: there is no CLOSED
 * status and deliberately so. A closed ride is recorded as what actually
 * happened to it, decided on the only evidence there is -- whether the driver
 * verified anyone's boarding code:
 *
 *   someone boarded  -> COMPLETED. People demonstrably travelled, so the money
 *                       settles by the ordinary rules: the driver is paid for
 *                       riders they verified, unverified riders are treated as
 *                       no-shows exactly as on any completed ride.
 *   nobody boarded   -> CANCELLED, and every rider refunded in full. No code
 *                       was ever checked, so there is no evidence the trip
 *                       happened at all, and charging for it would be charging
 *                       on an assumption.
 *
 * Inventing a third terminal status would have meant teaching every filter,
 * badge and settlement path about a state that answers neither question a
 * rider actually asks -- did I travel, and where is my money. The reason is
 * recorded on the ride instead, so the audit trail keeps what the status drops.
 */
import { db } from './firestore';
import { closeDeadline, type RideForDeadline } from './rideDeadline';
import { refundPaymentToSource } from './razorpay';
import { round2 } from './money';

export interface AutoCloseResult {
  rideId: string;
  outcome: 'COMPLETED' | 'CANCELLED';
  bookingsTouched: number;
  refunded: number;
  reason: string;
}

interface Log { error: (...a: any[]) => void; info?: (...a: any[]) => void }

/**
 * Close one overdue ride.
 *
 * Returns null when the ride turns out not to be closable after all -- the
 * deadline is re-checked here rather than trusted from the caller's query, so
 * a driver who completes their ride between the scan and this call wins.
 */
export async function autoCloseRide(
  rideId: string,
  log?: Log
): Promise<AutoCloseResult | null> {
  const rideRef = db.collection('rides').doc(rideId);
  const rideSnap = await rideRef.get();
  if (!rideSnap.exists) return null;
  const ride = rideSnap.data()!;
  if (String(ride.status) !== 'STARTED') return null;

  const deadline = closeDeadline(ride as RideForDeadline);
  if (!deadline || Date.now() < Date.parse(deadline.at)) return null;

  // Live bookings only. NONE as well as HELD: a pay-the-driver booking holds
  // no escrow and is a real seat with a real person in it, and its rider is
  // exactly as entitled to an answer about their trip.
  const bookingsSnap = await db.collection('bookings')
    .where('ride_id', '==', rideId)
    .get();
  const live = bookingsSnap.docs.filter((d) => {
    const s = String(d.data().escrow_status ?? '');
    return s === 'HELD' || s === 'NONE';
  });

  const anyBoarded = live.some((d) => d.data().boarding_verified === true);
  const reason = `AUTO_CLOSED_AFTER_${Math.round(deadline.hours)}H`;
  const closedAt = new Date().toISOString();

  const audit = {
    auto_closed: true,
    auto_closed_at: closedAt,
    auto_close_reason: reason,
    auto_close_deadline: deadline.at,
    auto_close_km: deadline.kmUsed,
    auto_close_basis: deadline.basis,
    updated_at: closedAt,
  };

  // ── Someone boarded: the trip happened. Settle by the ordinary rules. ────
  //
  // Marked COMPLETED and left for the settlement sweep rather than paid out
  // here: that sweep already knows how to split verified riders from no-shows,
  // honours the dispute window, and is the only place driver money moves. A
  // second payout path would be a second set of money rules to keep in step.
  if (anyBoarded) {
    await rideRef.update({ status: 'COMPLETED', completed_at: closedAt, ...audit });
    log?.info?.({ rideId, bookings: live.length }, 'Auto-closed as completed: boarding was verified');
    return {
      rideId, outcome: 'COMPLETED', bookingsTouched: live.length, refunded: 0, reason,
    };
  }

  // ── Nobody boarded: no evidence of a trip. Everyone gets their money. ────
  let refunded = 0;
  for (const doc of live) {
    const b = doc.data();
    // Nothing was taken for a pay-the-driver seat, so there is nothing to
    // send back -- asking Razorpay to refund a payment that never existed
    // would fail and strand the rest of the sweep.
    const amount = round2(Number(b.total_due ?? b.fare_amount ?? 0));
    const viaRazorpay = b.payment_method === 'RAZORPAY' && b.razorpay_payment_id;

    let sourceRefund: { refund_id: string; status: string } | null = null;
    if (viaRazorpay && amount > 0) {
      try {
        sourceRefund = await refundPaymentToSource({
          paymentId: String(b.razorpay_payment_id),
          amountRupees: amount,
          referenceId: `autoclose_${doc.id}`,
          notes: { reason, ride_id: rideId },
        });
      } catch (err) {
        // Leave this booking untouched and carry on with the others. A rider
        // whose refund failed keeps a HELD booking, which is recoverable and
        // visible; marking it refunded when the money never moved is not.
        log?.error({ err, booking: doc.id }, 'Auto-close refund to source failed');
        await db.collection('failed_refunds').doc(String(b.razorpay_payment_id)).set({
          payment_id: b.razorpay_payment_id,
          rider_id: b.rider_id ?? null,
          booking_id: doc.id,
          ride_id: rideId,
          amount,
          reason,
          failed_at: closedAt,
        }, { merge: true });
        continue;
      }
    }

    // Wallet-funded and cash seats settle in Firestore alone.
    if (!sourceRefund && viaRazorpay) continue;

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const f = fresh.data();
      if (!f) return;
      const s = String(f.escrow_status ?? '');
      if (s !== 'HELD' && s !== 'NONE') return; // decided elsewhere meanwhile

      tx.update(doc.ref, {
        booking_status: 'CANCELLED',
        escrow_status: 'CANCELLED',
        payment_status: amount > 0 ? 'REFUNDED' : 'CANCELLED',
        cancelled_by: 'SYSTEM',
        cancellation_fee: 0,
        refunded_amount: amount,
        refund_destination: sourceRefund ? 'SOURCE' : (viaRazorpay ? 'SOURCE' : 'WALLET'),
        refund_id: sourceRefund?.refund_id ?? null,
        auto_close_reason: reason,
        updated_at: closedAt,
      });

      // No wallet credit when the money went back to the card: crediting both
      // would refund the rider twice.
      if (!sourceRefund && amount > 0 && b.payment_method !== 'PAY_DRIVER') {
        const wref = db.collection('wallets').doc(String(b.rider_id));
        const w = await tx.get(wref);
        const cur = w.data() ?? {};
        tx.set(wref, {
          ...cur,
          available_wallet_balance: round2((cur.available_wallet_balance || 0) + amount),
        }, { merge: true });
      }
    });
    refunded += 1;
  }

  await rideRef.update({
    status: 'CANCELLED',
    cancellation_reason: reason,
    ...audit,
  });
  log?.info?.({ rideId, refunded }, 'Auto-closed as cancelled: nobody boarded');
  return {
    rideId, outcome: 'CANCELLED', bookingsTouched: live.length, refunded, reason,
  };
}
