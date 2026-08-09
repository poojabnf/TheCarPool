import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID, randomInt, timingSafeEqual } from 'crypto';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { sendPushToUser } from '../lib/fcm';
import { claimPaymentInTransaction } from '../lib/wallet';
import { getRazorpay, isRazorpayConfigured, refundPaymentToSource } from '../lib/razorpay';
import {
  CONVENIENCE_FEE,
  bookingTotal,
  insurancePremium,
  cancellationOutcome,
  noShowOutcome,
} from '../lib/fees';

/** Rounds to paise — booking amounts are rupees held as JS numbers. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const CreateBookingSchema = z.object({
  ride_id: z.string().min(1),
  rider_id: z.string().min(1),
  seats_booked: z.number().int().positive(),
  pickup_lng: z.number(),
  pickup_lat: z.number(),
  drop_lng: z.number(),
  drop_lat: z.number(),
  // Funding. A booking cannot exist without one of these covering the full
  // total — there is no "book now, pay later" path.
  //
  // Defaults to WALLET for backwards compatibility: builds shipped before this
  // change don't send the field at all, and they top the wallet up via
  // /payments/verify immediately before booking. Treating them as wallet
  // payments keeps those clients working AND still enforces full payment (the
  // wallet debit fails if the balance doesn't cover the fare). Making this
  // field required would 400 every booking from every installed app.
  payment_method: z.enum(['RAZORPAY', 'WALLET']).optional().default('WALLET'),
  razorpay_payment_id: z.string().min(1).optional(),
  /** Rider opted into the optional journey insurance. */
  insurance_opted: z.boolean().optional().default(false),
});

// Avoided-emission factors per shared passenger-km, by the pooled vehicle's
// type (kg CO2 / km), per IPCC-aligned figures. A diesel/petrol (ICE) pool
// prevents far more than an EV pool relative to everyone driving solo.
const EMISSION_FACTORS_KG_PER_KM: Record<string, number> = {
  ICE: 0.120,
  PETROL: 0.120,
  DIESEL: 0.120,
  CAR: 0.120,   // assume ICE car unless flagged EV/hybrid
  HYBRID: 0.070,
  BIKE: 0.060,
  EV: 0.0,
};

function emissionFactorFor(vehicleType?: string, isEv?: boolean): number {
  if (isEv) return EMISSION_FACTORS_KG_PER_KM.EV;
  const key = (vehicleType || 'ICE').toUpperCase();
  return EMISSION_FACTORS_KG_PER_KM[key] ?? EMISSION_FACTORS_KG_PER_KM.ICE;
}

// Boarding codes are only 4 digits, so brute force is cheap without a cap.
const MAX_BOARDING_OTP_ATTEMPTS = 5;

/**
 * Price a cancellation from the stored booking amounts.
 *
 * Both the preview endpoint and the real cancel call go through here, so the
 * figure shown in the confirmation dialog is by construction the figure
 * charged. Amounts come off the booking (frozen at purchase), falling back to
 * the ride only for bookings created before amounts were stored.
 */
function quoteCancellation(booking: any, ride: any) {
  const fare = Number(
    booking.fare_amount ?? Number(ride?.price_split || 0) * Number(booking.seats_booked || 1)
  );
  const premium = Number(booking.insurance_premium || 0);
  const departureMs = ride?.departure_time ? new Date(ride.departure_time).getTime() : NaN;
  const minutesToDeparture = Number.isFinite(departureMs)
    ? (departureMs - Date.now()) / 60000
    : NaN;
  return {
    fare: round2(fare),
    premium: round2(premium),
    minutesToDeparture,
    outcome: cancellationOutcome(fare, minutesToDeparture, premium),
  };
}

/** Resolve a ride's driver uid, preferring the denormalised field. */
async function resolveDriverUid(ride: any): Promise<string | null> {
  if (ride?.driver_uid) return String(ride.driver_uid);
  if (!ride?.driver_id) return null;
  const drv = await db.collection('drivers').doc(String(ride.driver_id)).get();
  return drv.exists && drv.data()?.user_id ? String(drv.data()!.user_id) : null;
}

interface CreateBookingBody {
  ride_id: string;
  rider_id: string;
  seats_booked: number;
  pickup_lng: number;
  pickup_lat: number;
  drop_lng: number;
  drop_lat: number;
}

export async function bookingRoutes(fastify: FastifyInstance) {

  // 1. Create booking & Lock funds in Escrow using Firestore Transactions
  fastify.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = parseOrReply(CreateBookingSchema, request.body, reply);
    if (!parsed) return;
    const {
      ride_id, rider_id, seats_booked, pickup_lng, pickup_lat, drop_lng, drop_lat,
      payment_method, razorpay_payment_id, insurance_opted,
    } = parsed;

    if (String(request.user?.id) !== String(rider_id)) {
      return reply.code(403).send({ error: 'Forbidden: Rider ID mismatch.' });
    }

    // Verification gate: browsing is open, but booking requires a KYC-verified
    // account. Enforced here so the client-side gate can't be bypassed.
    const riderDoc = await db.collection('users').doc(String(request.user!.id)).get();
    if (riderDoc.data()?.kyc_status !== 'VERIFIED') {
      return reply.code(403).send({
        error: 'VERIFICATION_REQUIRED',
        message: 'Complete identity verification to book a ride.',
      });
    }

    const bookingId = 'booking_' + randomUUID();
    const riderGender = riderDoc.data()?.gender;

    // ── Price the seat before taking any money ──────────────────────────────
    const rideSnapshot = await db.collection('rides').doc(String(ride_id)).get();
    if (!rideSnapshot.exists) {
      return reply.code(404).send({ error: 'Commute ride pool not found.' });
    }
    const rideForQuote = rideSnapshot.data()!;
    const fareAmount = round2(Number(rideForQuote.price_split || 0) * seats_booked);
    const insuranceAmount = insurance_opted
      ? insurancePremium(Number(rideForQuote.distance_km || 0))
      : 0;
    const totalDue = bookingTotal(fareAmount, insuranceAmount);

    if (totalDue <= 0) {
      return reply.code(400).send({ error: 'This ride has no valid fare configured.' });
    }

    // ── Verify the funding covers it, before the seat is held ───────────────
    // Razorpay is the source of truth for the amount; the client never gets to
    // say what it paid.
    let capturedAmount = 0;
    if (payment_method === 'RAZORPAY') {
      if (!razorpay_payment_id) {
        return reply.code(400).send({ error: 'razorpay_payment_id is required for a card/UPI booking.' });
      }
      if (!isRazorpayConfigured()) {
        return reply.code(503).send({ error: 'Payments are not configured on this server.' });
      }
      try {
        const payment: any = await getRazorpay().payments.fetch(razorpay_payment_id);
        if (!payment || (payment.status !== 'captured' && payment.status !== 'authorized')) {
          return reply.code(400).send({ error: 'PAYMENT_NOT_CAPTURED', message: 'That payment has not completed.' });
        }
        capturedAmount = Number(payment.amount) / 100;
      } catch (err: any) {
        fastify.log.error(err, 'Could not fetch payment for booking');
        return reply.code(502).send({ error: 'Could not verify your payment with the gateway.' });
      }
      if (capturedAmount + 0.01 < totalDue) {
        return reply.code(402).send({
          error: 'PAYMENT_TOO_SMALL',
          message: 'The payment does not cover the full fare.',
          amount_due: totalDue,
          amount_paid: capturedAmount,
        });
      }
    }

    const payRef = payment_method === 'RAZORPAY'
      ? db.collection('payments').doc(String(razorpay_payment_id))
      : null;
    const riderWalletRef = db.collection('wallets').doc(String(rider_id));

    try {
      const result = await db.runTransaction(async (transaction) => {
        const rideRef = db.collection('rides').doc(String(ride_id));

        // Firestore requires ALL reads before ANY writes.
        const rideDoc = await transaction.get(rideRef);
        const payDoc = payRef ? await transaction.get(payRef) : null;
        const walletDoc = payment_method === 'WALLET'
          ? await transaction.get(riderWalletRef)
          : null;

        if (!rideDoc.exists) {
          throw new Error('NOT_FOUND');
        }

        const ride = rideDoc.data()!;
        if (ride.status !== 'SCHEDULED') {
          throw new Error('NOT_OPEN');
        }

        // Women-only rides are bookable only by female riders (server-enforced).
        if (ride.women_only && riderGender !== 'FEMALE') {
          throw new Error('WOMEN_ONLY');
        }

        if (ride.seats_available < seats_booked) {
          throw new Error('NO_SEATS');
        }

        // The fare must not have moved between the quote and this transaction.
        if (round2(Number(ride.price_split || 0) * seats_booked) !== fareAmount) {
          throw new Error('PRICE_CHANGED');
        }

        // Take the money. Either path throws rather than creating an unpaid seat.
        if (payment_method === 'RAZORPAY') {
          claimPaymentInTransaction(transaction, payDoc!, {
            paymentId: String(razorpay_payment_id),
            uid: String(rider_id),
            bookingId,
            amountRupees: capturedAmount,
            requiredRupees: totalDue,
          });
        } else {
          const cur = walletDoc!.exists
            ? walletDoc!.data()!
            : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
          const available = Number(cur.available_wallet_balance || 0);
          if (available + 0.01 < totalDue) {
            throw new Error('INSUFFICIENT_WALLET');
          }
          transaction.set(riderWalletRef, {
            ...cur,
            available_wallet_balance: round2(available - totalDue),
          }, { merge: true });
        }

        // Decrement seats in Firestore
        transaction.update(rideRef, {
          seats_available: ride.seats_available - seats_booked
        });

        // 4-digit boarding code the rider reads out to the driver. Uses the CSPRNG
        // (Math.random is predictable and must never back a security code).
        const boarding_otp = String(randomInt(1000, 10000));

        // Create Booking doc
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingData = {
          id: bookingId,
          ride_id: String(ride_id),
          rider_id: String(rider_id),
          seats_booked,
          pickup_point: { lat: pickup_lat, lng: pickup_lng },
          drop_point: { lat: drop_lat, lng: drop_lng },
          boarding_otp,
          boarding_verified: false,
          // Amounts are frozen on the booking: later settlement, cancellation
          // and no-show maths must never re-derive them from the ride, whose
          // price the driver can still edit.
          fare_amount: fareAmount,
          insurance_opted: !!insurance_opted,
          insurance_premium: insuranceAmount,
          convenience_fee: CONVENIENCE_FEE,
          total_paid: totalDue,
          payment_method,
          razorpay_payment_id: razorpay_payment_id ?? null,
          payment_status: 'PAID',
          escrow_status: 'HELD',
          created_at: new Date().toISOString()
        };
        transaction.set(bookingRef, bookingData);

        return {
          id: bookingId,
          boarding_otp,
          fare_amount: fareAmount,
          insurance_premium: insuranceAmount,
          convenience_fee: CONVENIENCE_FEE,
          total_paid: totalDue,
          payment_status: 'PAID',
          escrow_status: 'HELD',
        };
      });

      // Fire-and-forget push notifications — do not await, do not block response
      const rideSnap = await db.collection('rides').doc(String(ride_id)).get();
      const driverUid = rideSnap.exists ? rideSnap.data()?.driver_uid : null;

      sendPushToUser(
        String(rider_id),
        '✅ Booking Confirmed!',
        `Your seat is reserved. Escrow locked. Booking #${bookingId}`,
        { booking_id: bookingId, type: 'BOOKING_CONFIRMED' }
      );

      if (driverUid) {
        sendPushToUser(
          driverUid,
          '🚗 New Seat Booked',
          `A rider has booked a seat on your commute. ${seats_booked} seat(s) filled.`,
          { booking_id: bookingId, type: 'RIDER_JOINED' }
        );
      }

      return reply.code(201).send(result);
    } catch (err: any) {
      // The seat was never confirmed, so the rider has no booking and no
      // wallet relationship with this money — send it straight back to the
      // card/UPI they paid with. (Wallet refunds apply only once a booking
      // exists and is later cancelled.) The claim transaction rolled back, so
      // the payment is still unconsumed and safe to refund in full.
      let refunded: { refund_id: string; status: string } | null = null;
      if (payment_method === 'RAZORPAY' && razorpay_payment_id && capturedAmount > 0) {
        try {
          const r = await refundPaymentToSource({
            paymentId: razorpay_payment_id,
            referenceId: `bookingfail_${bookingId}`,
            notes: { reason: err.message || 'BOOKING_FAILED', ride_id: String(ride_id) },
          });
          refunded = r;
          fastify.log.info(
            { payment_id: razorpay_payment_id, refund_id: r.refund_id },
            'Refunded to source after failed booking'
          );
        } catch (refundErr: any) {
          // Surface loudly — this is money held with no booking behind it.
          fastify.log.error(
            { err: refundErr, payment_id: razorpay_payment_id, rider_id },
            'REFUND FAILED after failed booking — needs manual reconciliation'
          );
          await db.collection('failed_refunds').doc(String(razorpay_payment_id)).set({
            payment_id: razorpay_payment_id,
            rider_id: String(rider_id),
            amount: capturedAmount,
            reason: err.message || 'BOOKING_FAILED',
            created_at: new Date().toISOString(),
          }, { merge: true }).catch(() => { /* best effort */ });
        }
      }
      const refundNote = refunded
        ? ' Your payment has been refunded to your original payment method.'
        : (payment_method === 'RAZORPAY' && capturedAmount > 0
          ? ' Your payment will be refunded to your original payment method.'
          : '');

      if (err.message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Commute ride pool not found.', message: 'Commute ride pool not found.' + refundNote });
      }
      if (err.message === 'NOT_OPEN') {
        return reply.code(400).send({ error: 'This ride pool is no longer open for booking.', message: 'This ride pool is no longer open for booking.' + refundNote });
      }
      if (err.message === 'NO_SEATS') {
        return reply.code(400).send({ error: 'Insufficient seats available.', message: 'That seat was just taken.' + refundNote });
      }
      if (err.message === 'WOMEN_ONLY') {
        return reply.code(403).send({ error: 'WOMEN_ONLY', message: 'This ride is reserved for women riders.' + refundNote });
      }
      if (err.message === 'PRICE_CHANGED') {
        return reply.code(409).send({ error: 'PRICE_CHANGED', message: 'The fare for this ride changed. Please review and try again.' + refundNote });
      }
      if (err.message === 'INSUFFICIENT_WALLET') {
        return reply.code(402).send({ error: 'INSUFFICIENT_WALLET', message: 'Your wallet balance does not cover this booking.', amount_due: totalDue });
      }
      if (err.message === 'PAYMENT_ALREADY_USED') {
        return reply.code(409).send({ error: 'PAYMENT_ALREADY_USED', message: 'That payment has already been used.' });
      }
      if (err.message === 'PAYMENT_NOT_YOURS') {
        return reply.code(403).send({ error: 'PAYMENT_NOT_YOURS', message: 'That payment belongs to another account.' });
      }
      if (err.message === 'PAYMENT_TOO_SMALL') {
        return reply.code(402).send({ error: 'PAYMENT_TOO_SMALL', message: 'The payment does not cover the full fare.', amount_due: totalDue });
      }
      fastify.log.error('Booking transaction aborted:', err);
      return reply.code(500).send({ error: 'Failed to complete escrow booking.', message: 'We could not confirm your seat.' + refundNote });
    }
  });

  // 1b. Verify rider boarding OTP (driver enters the rider's 4-digit code).
  //
  // Only the ride's own driver may call this. The code is short (4 digits), so
  // guessing is cheap — attempts are capped and counted atomically on the
  // booking doc, and the comparison is timing-safe.
  fastify.post('/:id/verify-boarding-otp', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { otp } = (request.body as { otp?: string }) || {};
    const uid = String(request.user!.id);

    if (!otp || typeof otp !== 'string' || !/^\d{4}$/.test(otp.trim())) {
      return reply.code(400).send({ error: 'Provide a valid 4-digit OTP.' });
    }
    const supplied = otp.trim();

    try {
      const bookingRef = db.collection('bookings').doc(id);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) {
        return reply.code(404).send({ error: 'Booking not found.' });
      }

      const booking = bookingDoc.data()!;

      // Authorisation: the caller must be the driver of the booking's ride.
      // Without this any authenticated user could mark any booking as boarded.
      const rideDoc = await db.collection('rides').doc(String(booking.ride_id)).get();
      if (!rideDoc.exists) {
        return reply.code(404).send({ error: 'Ride associated with booking not found.' });
      }
      const ride = rideDoc.data()!;
      let driverUid: string | null = ride.driver_uid ? String(ride.driver_uid) : null;
      if (!driverUid && ride.driver_id) {
        const drvDoc = await db.collection('drivers').doc(String(ride.driver_id)).get();
        driverUid = drvDoc.exists ? String(drvDoc.data()?.user_id) : null;
      }
      if (driverUid !== uid) {
        return reply.code(403).send({ error: 'Forbidden: only the ride driver can verify boarding.' });
      }

      if (booking.boarding_verified === true) {
        return reply.send({ status: 'VERIFIED', message: 'This rider was already verified.' });
      }
      if (booking.escrow_status !== 'HELD') {
        return reply.code(400).send({ error: 'This booking is no longer active.' });
      }

      const result = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(bookingRef);
        const b = fresh.data()!;
        const attempts = Number(b.boarding_otp_attempts || 0);
        if (attempts >= MAX_BOARDING_OTP_ATTEMPTS) {
          throw new Error('TOO_MANY_ATTEMPTS');
        }

        const expected = String(b.boarding_otp ?? '');
        const ok = expected.length === supplied.length &&
          timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));

        if (!ok) {
          tx.update(bookingRef, { boarding_otp_attempts: attempts + 1 });
          return { ok: false, remaining: MAX_BOARDING_OTP_ATTEMPTS - (attempts + 1) };
        }

        tx.update(bookingRef, {
          boarding_verified: true,
          boarding_verified_at: new Date().toISOString(),
          boarding_verified_by: uid,
        });
        return { ok: true, remaining: 0 };
      });

      if (!result.ok) {
        return reply.code(400).send({
          error: 'INVALID_OTP',
          message: 'Incorrect boarding code. Please ask the rider to read it out again.',
          attempts_remaining: result.remaining,
        });
      }

      sendPushToUser(
        booking.rider_id,
        '🛡️ Boarding Verified!',
        'Your driver verified your boarding code. Have a safe trip!',
        { booking_id: id, type: 'BOARDING_VERIFIED' }
      );

      return reply.send({ status: 'VERIFIED', message: 'Rider identity verified successfully!' });
    } catch (err: any) {
      if (err.message === 'TOO_MANY_ATTEMPTS') {
        return reply.code(429).send({
          error: 'TOO_MANY_ATTEMPTS',
          message: 'Too many incorrect codes. Ask the rider to re-open their trip screen, or contact support.',
        });
      }
      fastify.log.error(err, 'Failed to verify boarding OTP');
      return reply.code(500).send({ error: 'Failed to verify boarding OTP.' });
    }
  });

  // 2. Settle escrow in Firestore (Triggered when ride completes)
  fastify.post('/:id/escrow-settle', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const bookingRef = db.collection('bookings').doc(id);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) {
        return reply.code(404).send({ error: 'Booking not found.' });
      }

      const booking = bookingDoc.data()!;
      const rideRef = db.collection('rides').doc(String(booking.ride_id));
      const rideDoc = await rideRef.get();
      if (!rideDoc.exists) {
        return reply.code(404).send({ error: 'Ride associated with booking not found.' });
      }

      const ride = rideDoc.data()!;

      // Resolve the driver's uid the same way every other route does: prefer the
      // denormalised `driver_uid` on the ride, only falling back to the drivers
      // collection. Looking at `driver_id` alone left driver_id null on rides
      // that only carry driver_uid — the booking settled and nobody was paid.
      let driver_id: string | null = ride.driver_uid ? String(ride.driver_uid) : null;
      if (!driver_id && ride.driver_id) {
        const driverDoc = await db.collection('drivers').doc(String(ride.driver_id)).get();
        driver_id = driverDoc.exists && driverDoc.data()?.user_id ? String(driverDoc.data()!.user_id) : null;
      }
      const rider_id = booking.rider_id;

      const requesterId = String(request.user?.id);
      if (requesterId !== String(driver_id) && requesterId !== String(rider_id)) {
        return reply.code(403).send({ error: 'Forbidden: Only the rider or driver can settle the escrow.' });
      }

      if (booking.escrow_status !== 'HELD') {
        return reply.code(400).send({ error: 'No active locked booking found for ID.' });
      }

      // The driver is only paid for a rider they actually verified aboard. This
      // is the same gate as ride-completion settlement; without it this endpoint
      // would be a way around the boarding OTP entirely.
      if (booking.boarding_verified !== true) {
        return reply.code(409).send({
          error: 'BOARDING_NOT_VERIFIED',
          message: 'Verify the rider\'s 4-digit boarding code before releasing payment.',
        });
      }

      // Settle: move the fare from escrow to the driver's wallet, atomically
      // with the booking status flip so we can't double-release.
      // Refuse rather than settle into the void: flipping the booking to SETTLED
      // without a payee would burn the rider's money with no way to replay it.
      if (!driver_id) {
        fastify.log.error({ booking_id: id, ride_id: booking.ride_id }, 'Cannot settle escrow: unresolved driver uid');
        return reply.code(409).send({ error: 'Cannot settle: the ride has no resolvable driver account.' });
      }

      const fareAmount = Number(ride.price_split || 0) * Number(booking.seats_booked || 1);
      const driverWalletRef = db.collection('wallets').doc(String(driver_id));

      await db.runTransaction(async (tx) => {
        // Firestore requires ALL reads before ANY writes.
        const freshBooking = await tx.get(bookingRef);
        if (freshBooking.data()?.escrow_status !== 'HELD') {
          throw new Error('ALREADY_SETTLED');
        }
        const walletDoc = await tx.get(driverWalletRef);

        tx.update(bookingRef, {
          payment_status: 'RELEASED',
          escrow_status: 'SETTLED',
          settled_amount: fareAmount,
          settled_at: new Date().toISOString(),
        });
        const cur = walletDoc.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
        tx.set(driverWalletRef, { ...cur, available_wallet_balance: (cur.available_wallet_balance || 0) + fareAmount }, { merge: true });
      });

      return reply.send({
        message: 'Escrow settlement completed. Funds released to driver wallet.',
        booking: {
          id,
          payment_status: 'RELEASED',
          escrow_status: 'SETTLED',
          settled_amount: fareAmount,
        }
      });
    } catch (err: any) {
      if (err.message === 'ALREADY_SETTLED') {
        return reply.code(400).send({ error: 'This booking has already been settled.' });
      }
      fastify.log.error('Escrow release failed:', err);
      return reply.code(500).send({ error: 'Failed to process escrow settlement.' });
    }
  });

  // 3. Carbon Offset & SafarPoints Tracker Dashboard (Sustainability & B2B ESG reporting)
  fastify.get('/carbon-savings/:user_id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id } = request.params as { user_id: string };

    if (String(request.user?.id) !== String(user_id)) {
      return reply.code(403).send({ error: "Forbidden: Cannot access another user's data." });
    }

    try {
      // Calculate carbon savings dynamically based on settled bookings in
      // Firestore, applying the correct emission factor for each ride's vehicle.
      const snap = await db.collection('bookings')
        .where('rider_id', '==', String(user_id))
        .where('escrow_status', '==', 'SETTLED')
        .get();

      const total_rides_shared = snap.size;
      const AVG_COMMUTE_KM_PER_SEAT = 8.4;

      // Cache ride→vehicle and driver→ev lookups to avoid duplicate reads.
      const rideCache = new Map<string, { vehicle_type?: string; is_ev?: boolean }>();

      let total_seats_booked = 0;
      let co2_saved_kg = 0;

      for (const doc of snap.docs) {
        const data = doc.data();
        const seats = data.seats_booked || 1;
        total_seats_booked += seats;

        const rideId = String(data.ride_id);
        let veh = rideCache.get(rideId);
        if (!veh) {
          const rideDoc = await db.collection('rides').doc(rideId).get();
          const ride = rideDoc.exists ? rideDoc.data()! : {};
          let isEv = ride.is_ev;
          if (isEv === undefined && ride.driver_id) {
            const drvDoc = await db.collection('drivers').doc(String(ride.driver_id)).get();
            isEv = drvDoc.exists ? drvDoc.data()?.is_ev : undefined;
          }
          veh = { vehicle_type: ride.vehicle_type, is_ev: isEv };
          rideCache.set(rideId, veh);
        }

        const factor = emissionFactorFor(veh.vehicle_type, veh.is_ev);
        co2_saved_kg += seats * AVG_COMMUTE_KM_PER_SEAT * factor;
      }

      const kms = total_seats_booked * AVG_COMMUTE_KM_PER_SEAT;
      const safarpoints = Math.floor(kms * 10); // 10 points per km shared

      return reply.send({
        user_id,
        total_commutes: total_rides_shared,
        kms_shared: kms,
        co2_saved_kg: parseFloat(co2_saved_kg.toFixed(2)),
        safarpoints_balance: safarpoints,
        linkedin_share_text: `🌳 I saved ${co2_saved_kg.toFixed(1)}kg of CO2 this month carpooling with coworkers on TheCarPool! Join the green commute movement.`,
        esg_audit_status: 'COMPLIANT'
      });
    } catch (err: any) {
      fastify.log.error('Failed to compute carbon metrics:', err);
      return reply.code(500).send({ error: 'Failed to generate sustainability savings report.' });
    }
  });

  // ── GET /mine — rider's own booking list ─────────────────────────────────
  fastify.get('/mine', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = String(request.user!.id);
    try {
      const snap = await db.collection('bookings')
        .where('rider_id', '==', uid)
        .orderBy('created_at', 'desc')
        .limit(50)
        .get();

      const bookings = await Promise.all(snap.docs.map(async (doc) => {
        const b = doc.data();
        // Enrich with ride details for display
        let ride: any = null;
        try {
          const rideDoc = await db.collection('rides').doc(String(b.ride_id)).get();
          if (rideDoc.exists) ride = rideDoc.data();
        } catch { /* ride enrichment is best-effort */ }

        return {
          id: doc.id,
          ride_id: b.ride_id,
          seats_booked: b.seats_booked,
          payment_status: b.payment_status,
          escrow_status: b.escrow_status,
          created_at: b.created_at,
          pickup_point: b.pickup_point,
          drop_point: b.drop_point,
          // Rider's own boarding code — this is the rider-scoped list, so it is
          // the one place the code is legitimately exposed.
          boarding_otp: b.boarding_otp ?? null,
          boarding_verified: b.boarding_verified ?? false,
          // Ride snapshot fields
          departure_time: ride?.departure_time ?? null,
          driver_name: ride?.driver_name ?? null,
          vehicle: ride?.vehicle ?? null,
          vehicle_plate: ride?.vehicle_plate ?? null,
          ride_status: ride?.status ?? null,
          price_split: ride?.price_split ?? null,
        };
      }));

      return reply.send({ bookings });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list bookings for rider');
      return reply.code(500).send({ error: 'Failed to fetch your bookings.' });
    }
  });

  // ── GET /for-ride/:ride_id — passenger manifest for the ride's driver ────
  // Lets the driver see who booked, how many seats, and their pickup points.
  fastify.get('/for-ride/:ride_id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id } = request.params as { ride_id: string };
    const uid = String(request.user!.id);
    try {
      const rideDoc = await db.collection('rides').doc(ride_id).get();
      if (!rideDoc.exists) return reply.code(404).send({ error: 'Ride not found.' });
      const ride = rideDoc.data()!;
      if (String(ride.driver_uid ?? ride.driver_id) !== uid) {
        return reply.code(403).send({ error: 'Forbidden: only the ride driver can view its passengers.' });
      }

      const snap = await db.collection('bookings').where('ride_id', '==', ride_id).get();
      // Cancellations write escrow_status='CANCELLED' (the old filter looked for
      // 'REFUNDED', so cancelled riders stayed on the driver's manifest and were
      // still counted against the ride's seats).
      const INACTIVE = new Set(['CANCELLED', 'REFUNDED']);
      const passengers = await Promise.all(
        snap.docs
          .filter((d) => !INACTIVE.has(String(d.data().escrow_status)) && d.data().status !== 'CANCELLED')
          .map(async (d) => {
            const b = d.data();
            let riderName = 'Rider';
            let riderRating: number | null = null;
            try {
              const u = await db.collection('users').doc(String(b.rider_id)).get();
              if (u.exists) {
                riderName = u.data()!.full_name || u.data()!.name || 'Rider';
                riderRating = u.data()!.rating_avg ? parseFloat(u.data()!.rating_avg.toFixed(1)) : null;
              }
            } catch { /* name enrichment is best-effort */ }
            return {
              booking_id: d.id,
              rider_id: String(b.rider_id),
              rider_name: riderName,
              rider_rating: riderRating,
              seats_booked: b.seats_booked,
              pickup_point: b.pickup_point ?? null,
              escrow_status: b.escrow_status,
              // Never the code itself — only whether this rider is verified, so
              // the driver UI can show who still needs to board.
              boarding_verified: b.boarding_verified ?? false,
            };
          })
      );

      const seatsBooked = passengers.reduce((s, p) => s + Number(p.seats_booked || 0), 0);
      return reply.send({ ride_id, passengers, seats_booked: seatsBooked, seats_total: ride.seats_total });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list ride passengers');
      return reply.code(500).send({ error: 'Failed to fetch passengers.' });
    }
  });

  // ── GET /:id — single booking detail ────────────────────────────────────
  fastify.get('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uid = String(request.user!.id);
    try {
      const doc = await db.collection('bookings').doc(id).get();
      if (!doc.exists) return reply.code(404).send({ error: 'Booking not found.' });

      const b = doc.data()!;
      // Only the rider or driver of the associated ride can view
      const isRider = String(b.rider_id) === uid;
      if (!isRider) {
        // Allow driver too — check via ride doc
        const rideDoc = await db.collection('rides').doc(String(b.ride_id)).get();
        const driverUid = rideDoc.exists ? String(rideDoc.data()?.driver_uid ?? '') : '';
        if (driverUid !== uid) {
          return reply.code(403).send({ error: 'Forbidden: you are not a participant of this booking.' });
        }
      }

      // The boarding code proves the rider is physically present, so it must
      // only ever go to the rider. A driver who could read it here would just
      // type it in themselves and the check would prove nothing.
      const { boarding_otp, boarding_otp_attempts, ...safe } = b;
      return reply.send({
        id: doc.id,
        ...safe,
        ...(isRider ? { boarding_otp } : {}),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch booking');
      return reply.code(500).send({ error: 'Failed to fetch booking.' });
    }
  });

  // ── GET /quote — price a seat before booking ─────────────────────────────
  // Single source of truth for the checkout breakdown, so the figures the rider
  // sees are the same ones the booking endpoint will charge.
  fastify.get('/quote', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id, seats } = request.query as { ride_id?: string; seats?: string };
    if (!ride_id) return reply.code(400).send({ error: 'ride_id is required.' });
    const seatCount = Math.max(1, parseInt(seats || '1', 10) || 1);

    try {
      const rideDoc = await db.collection('rides').doc(String(ride_id)).get();
      if (!rideDoc.exists) return reply.code(404).send({ error: 'Ride not found.' });
      const ride = rideDoc.data()!;

      const fare = round2(Number(ride.price_split || 0) * seatCount);
      const premium = insurancePremium(Number(ride.distance_km || 0));

      return reply.send({
        ride_id,
        seats: seatCount,
        distance_km: Number(ride.distance_km || 0) || null,
        // Stops the driver said they'd collect from. Offered to the rider
        // alongside the auto-suggested meeting points at checkout.
        pickup_points: Array.isArray(ride.pickup_points) ? ride.pickup_points : [],
        fare_amount: fare,
        convenience_fee: CONVENIENCE_FEE,
        // Optional — only added to the total if the rider opts in.
        insurance_premium: premium,
        insurance_available: premium > 0,
        total_without_insurance: bookingTotal(fare, 0),
        total_with_insurance: bookingTotal(fare, premium),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to quote booking');
      return reply.code(500).send({ error: 'Failed to quote booking.' });
    }
  });

  // ── GET /:id/cancellation-quote — what would cancelling cost right now? ───
  // Drives the confirmation dialog. Read-only: it charges nothing, and shares
  // its maths with the cancel endpoint so the two can never disagree.
  fastify.get('/:id/cancellation-quote', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uid = String(request.user!.id);
    try {
      const bookingDoc = await db.collection('bookings').doc(id).get();
      if (!bookingDoc.exists) return reply.code(404).send({ error: 'Booking not found.' });
      const b = bookingDoc.data()!;
      if (String(b.rider_id) !== uid) {
        return reply.code(403).send({ error: 'Forbidden: you can only quote your own bookings.' });
      }
      if (b.escrow_status !== 'HELD') {
        return reply.code(400).send({ error: 'This booking is no longer cancellable.' });
      }

      const rideDoc = await db.collection('rides').doc(String(b.ride_id)).get();
      const ride = rideDoc.exists ? rideDoc.data()! : {};
      const { outcome, fare, premium, minutesToDeparture } = quoteCancellation(b, ride);

      const headline = outcome.fee === 0
        ? 'Free cancellation — you get a full refund.'
        : `A ${outcome.fee_pct}% cancellation charge applies.`;

      return reply.send({
        booking_id: id,
        tier: outcome.tier,
        minutes_to_departure: Number.isFinite(minutesToDeparture)
          ? Math.round(minutesToDeparture)
          : null,
        fare_amount: fare,
        insurance_premium: premium,
        cancellation_fee: outcome.fee,
        cancellation_fee_pct: outcome.fee_pct,
        refund_amount: round2(outcome.refund + outcome.insurance_refund),
        refund_destination: 'WALLET',
        headline,
        // What the rider needs to read before deciding.
        detail: outcome.fee === 0
          ? `You'll get the full ₹${round2(fare + premium)} back in your TheCarPool wallet.`
          : `₹${outcome.fee} will be charged and ₹${round2(outcome.refund + outcome.insurance_refund)} returned to your TheCarPool wallet.`
          + (premium > 0 ? ' Your insurance premium is refunded in full.' : ''),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to quote cancellation');
      return reply.code(500).send({ error: 'Failed to quote cancellation.' });
    }
  });

  // ── PATCH /:id/cancel — rider cancels booking ─────────────────────────────
  fastify.patch('/:id/cancel', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uid = String(request.user!.id);

    try {
      const bookingRef = db.collection('bookings').doc(id);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) {
        return reply.code(404).send({ error: 'Booking not found.' });
      }

      const b = bookingDoc.data()!;
      if (String(b.rider_id) !== uid) {
        return reply.code(403).send({ error: 'Forbidden: you can only cancel your own bookings.' });
      }

      if (b.escrow_status === 'SETTLED' || b.escrow_status === 'CANCELLED') {
        return reply.code(400).send({ error: `Cannot cancel booking. Escrow status is already ${b.escrow_status}.` });
      }

      const rideRef = db.collection('rides').doc(String(b.ride_id));
      const rideDoc = await rideRef.get();
      if (!rideDoc.exists) {
        return reply.code(404).send({ error: 'Associated ride not found.' });
      }

      const ride = rideDoc.data()!;
      if (ride.status === 'COMPLETED') {
        return reply.code(400).send({ error: 'Cannot cancel booking on a completed ride.' });
      }

      // The booking is confirmed, so the refund goes to the wallet (a refund to
      // the original card only applies when a booking never came into being).
      const quote = quoteCancellation(b, ride);
      const { outcome, fare, premium } = quote;

      const walletRef = db.collection('wallets').doc(uid);
      const driverUid = await resolveDriverUid(ride);
      const driverWalletRef = outcome.driver_share > 0 && driverUid
        ? db.collection('wallets').doc(driverUid)
        : null;

      await db.runTransaction(async (tx) => {
        // Firestore requires ALL reads before ANY writes — read booking, ride
        // and wallets up front, then perform every write.
        const freshBookingDoc = await tx.get(bookingRef);
        const freshB = freshBookingDoc.data()!;
        if (freshB.escrow_status !== 'HELD') {
          throw new Error('ALREADY_PROCESSED');
        }

        const freshRideDoc = await tx.get(rideRef);
        const freshRide = freshRideDoc.data()!;

        const walletDoc = await tx.get(walletRef);
        const driverWalletDoc = driverWalletRef ? await tx.get(driverWalletRef) : null;
        const cur = walletDoc.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };

        // 1. Restore the freed seats on the ride
        tx.update(rideRef, {
          seats_available: (freshRide.seats_available || 0) + freshB.seats_booked,
        });

        // 2. Record the cancellation and exactly how the money was split
        tx.update(bookingRef, {
          escrow_status: 'CANCELLED',
          payment_status: outcome.fee > 0 ? 'CANCELLED_WITH_FEE' : 'CANCELLED_REFUNDED',
          cancelled_by: 'RIDER',
          cancellation_tier: outcome.tier,
          cancellation_fee: outcome.fee,
          cancellation_fee_pct: outcome.fee_pct,
          refunded_amount: outcome.refund + outcome.insurance_refund,
          driver_compensation: outcome.driver_share,
          platform_share: outcome.platform_share,
          cancelled_at: new Date().toISOString(),
        });

        // 3. Refund fare-minus-fee plus the full insurance premium to the wallet
        tx.set(walletRef, {
          ...cur,
          available_wallet_balance: round2(
            (cur.available_wallet_balance || 0) + outcome.refund + outcome.insurance_refund
          ),
        }, { merge: true });

        // 4. Compensate the driver when the rider bailed at the last minute
        if (driverWalletRef && driverWalletDoc) {
          const dcur = driverWalletDoc.exists
            ? driverWalletDoc.data()!
            : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
          tx.set(driverWalletRef, {
            ...dcur,
            available_wallet_balance: round2((dcur.available_wallet_balance || 0) + outcome.driver_share),
          }, { merge: true });
        }
      });

      return reply.send({
        status: 'BOOKING_CANCELLED',
        booking_id: id,
        tier: outcome.tier,
        fare_amount: fare,
        insurance_premium: premium,
        cancellation_fee: outcome.fee,
        cancellation_fee_pct: outcome.fee_pct,
        refunded_amount: round2(outcome.refund + outcome.insurance_refund),
        refunded_to: 'WALLET',
        driver_compensation: outcome.driver_share,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to cancel booking');
      if (err.message === 'ALREADY_PROCESSED') {
        return reply.code(400).send({ error: 'Booking has already been processed.' });
      }
      return reply.code(500).send({ error: 'Failed to cancel booking.' });
    }
  });
}
