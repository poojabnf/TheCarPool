import { FastifyInstance } from 'fastify';
import { defaultCurrency } from '../lib/config';
import { z } from 'zod';
import { randomUUID, randomInt, timingSafeEqual } from 'crypto';
import { db } from '../server';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { sendPushToUser } from '../lib/fcm';
import {
  notifyBookingRequested, notifyBookingConfirmed, notifyBookingDeclined,
  notifyRideCompletedForBooking,
} from '../lib/bookingNotifications';
import {
  isAtDestination, isDisputeWindowOpen, disputeMinutesRemaining,
  settlementDueAt, DISPUTE_WINDOW_MINUTES, canResolveDispute,
} from '../lib/settlement';

import { getUserEmail, buildRiderBookingEmail, buildDriverPassengerBookedEmail, sendEmail } from '../lib/email';
import { claimPaymentInTransaction } from '../lib/wallet';
import { getRazorpay, isRazorpayConfigured, refundPaymentToSource } from '../lib/razorpay';
import { isRouteConfigured, createHeldTransfer, reverseTransfer } from '../lib/route';
import {
  CONVENIENCE_FEE,
  bookingTotal,
  insurancePremium,
  cancellationOutcome,
  noShowOutcome,
} from '../lib/fees';
import { round2, isShortOf } from '../lib/money';
import { farePerSeatForPickup } from '../lib/stopPricing';
import {
  RESTRICTED_ITEMS,
  RESTRICTED_ITEMS_HEADLINE,
  RESTRICTED_ITEMS_ACK_LABEL,
  RESTRICTED_ITEMS_FOOTER,
} from '../lib/restrictedItems';

/**
 * Name the driver stop this rider is boarding at, when their pickup matches
 * one. Falls back to null so the message simply omits the line rather than
 * inventing a location — and never echoes raw coordinates, which are as
 * identifying as an address.
 */
function pickupLabelFor(
  rideSnap: FirebaseFirestore.DocumentSnapshot,
  lat: number,
  lng: number
): string | null {
  const stops = rideSnap.exists ? rideSnap.data()?.pickup_points : null;
  if (!Array.isArray(stops)) return null;
  // ~100m: close enough to be the same stop, loose enough for map jitter.
  const TOLERANCE = 0.001;
  const match = stops.find((s: any) =>
    typeof s?.lat === 'number' && typeof s?.lng === 'number' &&
    Math.abs(s.lat - lat) < TOLERANCE && Math.abs(s.lng - lng) < TOLERANCE
  );
  return match?.label ? String(match.label) : null;
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
  /**
   * What the rider is bringing beyond themselves — a suitcase, a bicycle, a
   * pet. The driver needs this BEFORE accepting: boot space and a willingness
   * to carry a dog are exactly the things worth declining over, and finding
   * out at the kerb wastes both people's morning.
   *
   * Free text, capped. Optional: most trips are a person and a bag.
   */
  luggage_note: z.string().trim().max(280).optional(),
  /**
   * The rider ticked the restricted-items declaration.
   *
   * Recorded rather than merely displayed. If something prohibited turns up in
   * a vehicle, what matters afterwards is being able to show the rider was
   * told and agreed, with a timestamp — a notice nobody has to acknowledge
   * proves nothing.
   */
  restricted_items_ack: z.boolean().optional().default(false),
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
      luggage_note, restricted_items_ack,
    } = parsed;

    if (String(request.user?.id) !== String(rider_id)) {
      return reply.code(403).send({ error: 'Forbidden: Rider ID mismatch.' });
    }

    const riderDoc = await db.collection('users').doc(String(request.user!.id)).get();

    const bookingId = 'booking_' + randomUUID();
    const riderGender = riderDoc.data()?.gender;

    // ── Price the seat before taking any money ──────────────────────────────
    const rideSnapshot = await db.collection('rides').doc(String(ride_id)).get();
    if (!rideSnapshot.exists) {
      return reply.code(404).send({ error: 'Commute ride pool not found.' });
    }
    const rideForQuote = rideSnapshot.data()!;
    // Boarding at a priced stop costs that stop's fare, not the full journey.
    // Shared with GET /quote through farePerSeatForPickup so the figure the
    // rider was shown is the figure they are charged.
    const pickupFare = farePerSeatForPickup({
      ridePrice: Number(rideForQuote.price_split || 0),
      stops: rideForQuote.pickup_points,
      pickupLat: pickup_lat,
      pickupLng: pickup_lng,
    });
    const fareAmount = round2(pickupFare.farePerSeat * seats_booked);
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
      if (isShortOf(capturedAmount, totalDue)) {
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
            : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };
          const available = Number(cur.available_wallet_balance || 0);
          if (isShortOf(available, totalDue)) {
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
          // Which stop's fare was applied, if any. Frozen with the amount so a
          // later edit to the ride cannot change what this rider agreed to.
          fare_via_stop: pickupFare.isStopFare ? (pickupFare.viaStopLabel ?? 'stop') : null,
          insurance_opted: !!insurance_opted,
          // What the rider is carrying, and their acknowledgement of the
          // restricted-items rules. Stored on the booking so it survives
          // independently of the ride and is available at dispute time.
          luggage_note: luggage_note?.trim() || null,
          restricted_items_ack: restricted_items_ack === true,
          restricted_items_ack_at: restricted_items_ack === true ? new Date().toISOString() : null,
          insurance_premium: insuranceAmount,
          convenience_fee: CONVENIENCE_FEE,
          total_paid: totalDue,
          payment_method,
          razorpay_payment_id: razorpay_payment_id ?? null,
          payment_status: 'PAID',
          escrow_status: 'HELD',
          // Drivers can require approval per ride. Off unless the ride asks
          // for it, so every existing ride keeps booking instantly.
          //
          // The seat is decremented and the fare held either way: a request
          // that did not hold its seat could be accepted after the ride sold
          // out, and one that did not hold the fare would need the rider to
          // come back and pay at the worst possible moment. A decline refunds
          // in full and returns the seat.
          booking_status: ride.requires_approval === true ? 'REQUESTED' : 'CONFIRMED',
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
          booking_status: bookingData.booking_status,
        };
      });

      // Fire-and-forget push notifications — do not await, do not block response
      const rideSnap = await db.collection('rides').doc(String(ride_id)).get();
      const driverUid = rideSnap.exists ? rideSnap.data()?.driver_uid : null;

      // Rich, privacy-safe messages across every configured channel. The old
      // pair of bare pushes said "a rider has booked" and nothing a driver
      // could act on — no name, no pickup point, no time.
      // ── Route: split the fare to the driver, held ──────────────────────────
      // Only for Razorpay-funded bookings (a transfer needs a payment to split)
      // and only when the driver has a linked account on file. Everyone else
      // keeps the wallet path, so no driver loses earnings by not being
      // onboarded yet.
      //
      // Held rather than settled: the money stays with Razorpay until the ride
      // completes, the dispute window closes, and settle-due releases it.
      if (payment_method === 'RAZORPAY' && razorpay_payment_id && driverUid && isRouteConfigured()) {
        try {
          const driverSnap = await db.collection('users').doc(String(driverUid)).get();
          const linkedAccount = driverSnap.data()?.razorpay_account_id;
          if (linkedAccount) {
            const transfer = await createHeldTransfer({
              paymentId: String(razorpay_payment_id),
              accountId: String(linkedAccount),
              // The driver's share is the fare. The insurance premium is held
              // for the insurer and is never part of their payout.
              amountRupees: fareAmount,
              notes: { booking_id: bookingId, ride_id: String(ride_id) },
            });
            await db.collection('bookings').doc(bookingId).update({
              route_transfer_id: transfer.id,
              route_transfer_status: transfer.status,
            });
          }
        } catch (err) {
          // Never fail a paid booking because the split did not happen — the
          // rider has been charged and holds a seat. Without a transfer the
          // booking settles through the wallet instead, which is recoverable;
          // rejecting it here would not be.
          fastify.log.error({ err, booking_id: bookingId }, 'Route transfer creation failed; falling back to wallet settlement');
        }
      }

      const notifyIds = { rideId: String(ride_id), riderUid: String(rider_id), driverUid };
      const notifyBooking = { ...result, seats_booked, pickup_label: pickupLabelFor(rideSnap, pickup_lat, pickup_lng) };
      if (result.booking_status === 'REQUESTED') {
        notifyBookingRequested(notifyIds, notifyBooking, fastify.log);
      } else {
        notifyBookingConfirmed(notifyIds, notifyBooking, fastify.log);
      }

      // Fire-and-forget email notifications to Rider & Driver
      (async () => {
        try {
          const rideData = rideSnap.exists ? rideSnap.data() : null;
          const riderContact = await getUserEmail(String(rider_id));
          const driverContact = driverUid ? await getUserEmail(String(driverUid)) : null;

          if (riderContact?.email && rideData) {
            const riderEmailData = buildRiderBookingEmail({
              riderName: riderContact.name,
              bookingId,
              rideId: String(ride_id),
              driverName: driverContact?.name || 'Verified Driver',
              seatsBooked: Number(seats_booked),
              fareAmount: Number(result.fare_amount || 0),
              insurancePremium: Number(result.insurance_premium || 0),
              convenienceFee: Number(result.convenience_fee || 0),
              totalPaid: Number(result.total_paid || 0),
              boardingOtp: result.boarding_otp,
              departureTime: rideData.departure_time || new Date().toISOString(),
              vehicle: {
                make: rideData.vehicle_make,
                model: rideData.vehicle_model,
                plate: rideData.vehicle_plate,
                type: rideData.vehicle_type,
              },
            });

            await sendEmail({
              to: riderContact.email,
              subject: riderEmailData.subject,
              html: riderEmailData.html,
              text: riderEmailData.text,
            });
          }

          if (driverContact?.email && rideData) {
            const driverEmailData = buildDriverPassengerBookedEmail({
              driverName: driverContact.name,
              riderName: riderContact?.name || 'A Passenger',
              bookingId,
              seatsBooked: Number(seats_booked),
              fareAmount: Number(result.fare_amount || 0),
              departureTime: rideData.departure_time || new Date().toISOString(),
            });

            await sendEmail({
              to: driverContact.email,
              subject: driverEmailData.subject,
              html: driverEmailData.html,
              text: driverEmailData.text,
            });
          }
        } catch (emailErr) {
          fastify.log.error(emailErr, 'Failed to send booking confirmation emails');
        }
      })();

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
  // ── Driver accepts or declines a seat request ────────────────────────────
  // Only reachable for rides the driver marked requires_approval. The seat and
  // the fare are already held from the moment of the request, so accepting is
  // just a state change; declining refunds in full and returns the seat.
  fastify.patch('/:id/decision', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { decision } = (request.body || {}) as { decision?: string };
    const uid = String(request.user!.id);

    if (decision !== 'ACCEPT' && decision !== 'DECLINE') {
      return reply.code(400).send({ error: 'INVALID_DECISION', message: 'decision must be ACCEPT or DECLINE.' });
    }

    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return reply.code(404).send({ error: 'Booking not found.' });
    const booking = bookingDoc.data()!;

    const rideRef = db.collection('rides').doc(String(booking.ride_id));
    const rideDoc = await rideRef.get();
    if (!rideDoc.exists) return reply.code(404).send({ error: 'Ride not found.' });
    const ride = rideDoc.data()!;

    if (String(ride.driver_uid ?? ride.driver_id) !== uid) {
      return reply.code(403).send({ error: 'Forbidden: only the ride driver can decide on this request.' });
    }
    // Anything already settled is out of scope — re-deciding a confirmed or
    // declined booking would double-refund or resurrect a released seat.
    if (String(booking.booking_status ?? 'CONFIRMED') !== 'REQUESTED') {
      return reply.code(409).send({
        error: 'NOT_PENDING',
        message: 'That request has already been decided.',
        booking_status: booking.booking_status ?? 'CONFIRMED',
      });
    }

    const riderUid = String(booking.rider_id ?? booking.rider_uid ?? '');

    if (decision === 'ACCEPT') {
      await bookingRef.update({
        booking_status: 'CONFIRMED',
        decided_at: new Date().toISOString(),
      });
      notifyBookingConfirmed(
        { rideId: String(booking.ride_id), riderUid, driverUid: uid },
        { ...booking, id },
        fastify.log
      );
      return reply.send({ id, booking_status: 'CONFIRMED' });
    }

    // DECLINE — refund everything the rider paid and give the seat back. The
    // rider did nothing wrong, so no cancellation fee applies; those tiers
    // price a rider changing their mind, not a driver turning them away.
    const refund = round2((Number(booking.total_paid) || 0));
    const riderWalletRef = db.collection('wallets').doc(riderUid);

    // A card/UPI payment goes back to the card/UPI, not to store credit.
    //
    // Wallet credit is the right answer when a rider cancels a seat they
    // held — they chose to use the service and can use it again. It is the
    // wrong answer here: the rider was turned away, never travelled, and had
    // no say in it. Handing them a balance they can only spend with us keeps
    // money they are owed outright.
    //
    // Done BEFORE the transaction: an outbound call inside one is retried
    // with it, and a duplicate refund is much worse than a retryable failure.
    // The idempotency key makes a repeat request safe at Razorpay's end.
    const paidByRazorpay = booking.payment_method === 'RAZORPAY' && booking.razorpay_payment_id;
    let sourceRefund: { refund_id: string; status: string } | null = null;
    if (paidByRazorpay && refund > 0) {
      try {
        sourceRefund = await refundPaymentToSource({
          paymentId: String(booking.razorpay_payment_id),
          amountRupees: refund,
          referenceId: `decline_${id}`,
          notes: { reason: 'DRIVER_DECLINED', ride_id: String(booking.ride_id) },
        });
      } catch (refundErr) {
        // Do not decline the booking if the money cannot follow. Leaving it
        // REQUESTED is recoverable — the driver can try again, and support
        // has a record. Declining anyway would strand a paid rider with no
        // seat and no refund, which is the one outcome with no way back.
        fastify.log.error(
          { err: refundErr, booking: id, payment_id: booking.razorpay_payment_id },
          'Decline aborted: refund to source failed'
        );
        await db.collection('failed_refunds').doc(String(booking.razorpay_payment_id)).set({
          payment_id: booking.razorpay_payment_id,
          rider_id: riderUid,
          amount: refund,
          reason: 'DRIVER_DECLINED',
          created_at: new Date().toISOString(),
        }, { merge: true }).catch(() => { /* best effort */ });
        return reply.code(502).send({
          error: 'REFUND_FAILED',
          message: "We couldn't return the rider's payment, so the request is unchanged. Please try again.",
        });
      }
    }

    // Release the driver's held split, if one was created at booking time.
    // Without this the transfer sits on hold at Razorpay forever: settlement
    // skips the booking once escrow_status is CANCELLED, so nothing else ever
    // looks at it, and the money is stranded between the two of them.
    if (booking.route_transfer_id) {
      try {
        await reverseTransfer(String(booking.route_transfer_id));
      } catch (revErr) {
        // The rider has already been made whole above, so this is a
        // reconciliation problem rather than a lost-money one. Record it.
        fastify.log.error(
          { err: revErr, booking: id, transfer: booking.route_transfer_id },
          'Route transfer reversal failed on decline — needs manual reconciliation'
        );
      }
    }
    try {
      await db.runTransaction(async (tx) => {
        const freshBooking = await tx.get(bookingRef);
        if (String(freshBooking.data()?.booking_status) !== 'REQUESTED') {
          throw new Error('ALREADY_DECIDED');
        }
        const freshRide = await tx.get(rideRef);
        const walletDoc = await tx.get(riderWalletRef);
        const cur = walletDoc.exists
          ? walletDoc.data()!
          : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };

        tx.update(bookingRef, {
          booking_status: 'DECLINED',
          escrow_status: 'CANCELLED',
          payment_status: 'CANCELLED_REFUNDED',
          cancelled_by: 'DRIVER',
          cancellation_fee: 0,
          refunded_amount: refund,
          refund_destination: sourceRefund ? 'SOURCE' : 'WALLET',
          refund_id: sourceRefund?.refund_id ?? null,
          decided_at: new Date().toISOString(),
        });
        tx.update(rideRef, {
          seats_available: (freshRide.data()?.seats_available || 0) + (Number(booking.seats_booked) || 0),
        });
        // Only credit the wallet for money that did NOT go back to source.
        // Doing both would refund the rider twice.
        if (!sourceRefund) {
          tx.set(riderWalletRef, {
            ...cur,
            available_wallet_balance: round2((cur.available_wallet_balance || 0) + refund),
          }, { merge: true });
        }
      });
    } catch (err: any) {
      if (String(err?.message) === 'ALREADY_DECIDED') {
        return reply.code(409).send({ error: 'NOT_PENDING', message: 'That request has already been decided.' });
      }
      fastify.log.error({ err, booking: id }, 'Declining booking failed');
      return reply.code(500).send({ error: 'Could not decline that request.' });
    }

    notifyBookingDeclined(
      { rideId: String(booking.ride_id), riderUid, driverUid: uid },
      { ...booking, id },
      fastify.log
    );
    return reply.send({
      id,
      booking_status: 'DECLINED',
      refunded_amount: refund,
      refund_destination: sourceRefund ? 'SOURCE' : 'WALLET',
    });
  });

  // ── Rider confirms the ride is over ──────────────────────────────────────
  // Two ways in, both landing here:
  //   - the rider taps "complete" in the app
  //   - the app reports their location and they are at the destination
  // The geofence is checked SERVER-side: a client that could self-report
  // arrival could complete a ride it never took and start a payout clock.
  fastify.post('/:id/complete', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { lat, lng } = (request.body || {}) as { lat?: number; lng?: number };
    const uid = String(request.user!.id);

    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return reply.code(404).send({ error: 'Booking not found.' });
    const booking = bookingDoc.data()!;

    if (String(booking.rider_id ?? booking.rider_uid) !== uid) {
      return reply.code(403).send({ error: 'Forbidden: only the rider can complete their own booking.' });
    }
    if (String(booking.escrow_status) !== 'HELD') {
      return reply.code(409).send({ error: 'NOT_ACTIVE', message: 'That booking is already settled or cancelled.' });
    }
    if (booking.completed_at) {
      return reply.send({
        id, already: true, completed_at: booking.completed_at,
        dispute_minutes_remaining: disputeMinutesRemaining(booking.completed_at),
      });
    }

    // When coordinates are supplied this is the automatic path, and the rider
    // must genuinely be at the drop point. Without coordinates it is a
    // deliberate tap, which needs no proximity check.
    if (lat !== undefined || lng !== undefined) {
      const drop = booking.drop_point ?? {};
      if (!isAtDestination(lat, lng, drop.lat, drop.lng)) {
        return reply.code(409).send({
          error: 'NOT_AT_DESTINATION',
          message: 'You do not appear to be at the drop-off point yet.',
        });
      }
    }

    const completedAt = new Date().toISOString();
    await bookingRef.update({
      completed_at: completedAt,
      settlement_due_at: settlementDueAt(completedAt),
      completed_by: lat !== undefined ? 'ARRIVAL' : 'RIDER',
    });

    notifyRideCompletedForBooking(
      { rideId: String(booking.ride_id), riderUid: uid },
      { ...booking, id },
      fastify.log
    );

    return reply.send({
      id,
      completed_at: completedAt,
      dispute_minutes_remaining: DISPUTE_WINDOW_MINUTES,
    });
  });

  // ── Rider disputes a completion ──────────────────────────────────────────
  // Money stays exactly where it is: escrow. A dispute does NOT auto-refund
  // (which would let a dishonest rider travel free) and does not pay out
  // (which would strand a rider who was wrongly marked complete). It freezes
  // the fare and flags it, and a human decides.
  fastify.post('/:id/dispute', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = (request.body || {}) as { reason?: string };
    const uid = String(request.user!.id);

    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return reply.code(404).send({ error: 'Booking not found.' });
    const booking = bookingDoc.data()!;

    if (String(booking.rider_id ?? booking.rider_uid) !== uid) {
      return reply.code(403).send({ error: 'Forbidden: only the rider can dispute their own ride.' });
    }
    if (String(booking.escrow_status) !== 'HELD') {
      return reply.code(409).send({
        error: 'ALREADY_SETTLED',
        message: 'That fare has already been settled. Contact support.',
      });
    }
    if (!isDisputeWindowOpen(booking.completed_at)) {
      return reply.code(409).send({
        error: 'WINDOW_CLOSED',
        message: `Disputes close ${DISPUTE_WINDOW_MINUTES} minutes after the ride is marked complete. Contact support.`,
      });
    }

    await bookingRef.update({
      disputed: true,
      disputed_at: new Date().toISOString(),
      dispute_reason: String(reason ?? '').slice(0, 500) || null,
    });

    fastify.log.warn({ booking_id: id, ride_id: booking.ride_id, rider: uid }, 'Ride completion disputed');
    return reply.send({ id, disputed: true, message: 'Your fare is on hold while we look into this.' });
  });

  // ── Admin: attach a driver's Route linked account ────────────────────────
  // Creating a linked account involves Razorpay's onboarding and activation
  // flow (identity, PAN, bank, product configuration), which is done in the
  // Razorpay dashboard. This records the resulting acc_… id against the
  // driver, which is all the transfer API needs.
  //
  // Once set, that driver's fares split to them at Razorpay instead of
  // accruing in the in-app wallet. Drivers without one are unaffected.
  fastify.post('/driver/:uid/linked-account', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const { account_id } = (request.body || {}) as { account_id?: string };

    // Razorpay linked account ids are prefixed acc_. Checking the shape here
    // stops a typo becoming a transfer failure at booking time, when the rider
    // has already paid.
    if (typeof account_id !== 'string' || !/^acc_[A-Za-z0-9]+$/.test(account_id.trim())) {
      return reply.code(400).send({
        error: 'INVALID_ACCOUNT_ID',
        message: 'account_id must be a Razorpay linked account id, e.g. acc_XXXXXXXX.',
      });
    }

    const userRef = db.collection('users').doc(String(uid));
    if (!(await userRef.get()).exists) {
      return reply.code(404).send({ error: 'User not found.' });
    }

    await userRef.set({
      razorpay_account_id: account_id.trim(),
      razorpay_account_linked_at: new Date().toISOString(),
    }, { merge: true });

    fastify.log.warn({ uid, account_id: account_id.trim() }, 'Route linked account attached to driver');
    return reply.send({ uid, razorpay_account_id: account_id.trim(), payouts_via: 'ROUTE' });
  });

  // ── Admin: list open disputes ────────────────────────────────────────────
  // Without this a disputed fare is invisible unless someone goes looking in
  // Firestore. The money is parked until a human decides, so there has to be
  // somewhere that shows what is waiting.
  fastify.get('/disputes', { preHandler: [requireAdmin] }, async (_request, reply) => {
    const snap = await db.collection('bookings')
      .where('disputed', '==', true)
      .where('escrow_status', '==', 'HELD')
      .limit(100)
      .get();

    const disputes = await Promise.all(snap.docs.map(async (d) => {
      const b = d.data();
      const rideSnap = await db.collection('rides').doc(String(b.ride_id)).get();
      const ride = rideSnap.exists ? rideSnap.data() : null;
      return {
        booking_id: d.id,
        ride_id: b.ride_id,
        rider_id: b.rider_id,
        driver_uid: ride?.driver_uid ?? ride?.driver_id ?? null,
        amount_held: round2(Number(b.total_paid) || 0),
        fare_amount: b.fare_amount ?? null,
        boarding_verified: b.boarding_verified ?? false,
        completed_at: b.completed_at ?? null,
        disputed_at: b.disputed_at ?? null,
        dispute_reason: b.dispute_reason ?? null,
        route: ride ? `${ride.source ?? '?'} → ${ride.destination ?? '?'}` : null,
      };
    }));

    return reply.send({ count: disputes.length, disputes });
  });

  // ── Admin: resolve a dispute ─────────────────────────────────────────────
  // Two outcomes, both final. PAY_DRIVER clears the flag and lets the normal
  // settlement sweep pay out; REFUND_RIDER returns the whole amount and closes
  // the booking. Deliberately no partial split: splitting a fare needs a policy
  // this product does not have yet, and inventing one here would bury it.
  fastify.post('/:id/resolve-dispute', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { resolution, note } = (request.body || {}) as { resolution?: string; note?: string };

    if (resolution !== 'PAY_DRIVER' && resolution !== 'REFUND_RIDER') {
      return reply.code(400).send({
        error: 'INVALID_RESOLUTION',
        message: 'resolution must be PAY_DRIVER or REFUND_RIDER.',
      });
    }

    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return reply.code(404).send({ error: 'Booking not found.' });
    const booking = bookingDoc.data()!;

    if (!canResolveDispute(booking)) {
      return reply.code(409).send({
        error: 'NOT_RESOLVABLE',
        message: booking.disputed !== true
          ? 'That booking is not disputed.'
          : 'That fare has already left escrow.',
      });
    }

    const resolvedAt = new Date().toISOString();
    const auditNote = String(note ?? '').slice(0, 500) || null;

    if (resolution === 'PAY_DRIVER') {
      // Clearing the flag is enough: settle-due already re-checks every
      // condition, so the fare pays out on the next sweep through the normal
      // path rather than a second, divergent copy of the payout maths.
      await bookingRef.update({
        disputed: false,
        dispute_resolution: 'PAY_DRIVER',
        dispute_resolved_at: resolvedAt,
        dispute_resolution_note: auditNote,
      });
      fastify.log.warn({ booking_id: id, resolution }, 'Dispute resolved in favour of driver');
      return reply.send({ id, resolution, settles_on_next_sweep: true });
    }

    // REFUND_RIDER — return the full amount and close the booking out.
    const riderUid = String(booking.rider_id ?? booking.rider_uid ?? '');
    const refund = round2(Number(booking.total_paid) || 0);
    const riderWalletRef = db.collection('wallets').doc(riderUid);

    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(bookingRef);
        if (!canResolveDispute(fresh.data() as any)) throw new Error('ALREADY_RESOLVED');
        const walletDoc = await tx.get(riderWalletRef);
        const cur = walletDoc.exists
          ? walletDoc.data()!
          : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };

        tx.update(bookingRef, {
          disputed: false,
          dispute_resolution: 'REFUND_RIDER',
          dispute_resolved_at: resolvedAt,
          dispute_resolution_note: auditNote,
          escrow_status: 'CANCELLED',
          payment_status: 'CANCELLED_REFUNDED',
          refunded_amount: refund,
        });
        tx.set(riderWalletRef, {
          ...cur,
          available_wallet_balance: round2((cur.available_wallet_balance || 0) + refund),
        }, { merge: true });
      });
    } catch (err: any) {
      if (String(err?.message) === 'ALREADY_RESOLVED') {
        return reply.code(409).send({ error: 'NOT_RESOLVABLE', message: 'That dispute was already resolved.' });
      }
      fastify.log.error({ err, booking_id: id }, 'Dispute refund failed');
      return reply.code(500).send({ error: 'Could not resolve that dispute.' });
    }

    fastify.log.warn({ booking_id: id, resolution, refund }, 'Dispute resolved in favour of rider');
    return reply.send({ id, resolution, refunded_amount: refund });
  });

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

      // A seat still awaiting the driver's decision cannot be boarded — that
      // would let an unapproved rider on and settle their fare at completion.
      // Bookings predating this field have no booking_status and are treated
      // as confirmed, which is what they were.
      const bookingStatus = String(booking.booking_status ?? 'CONFIRMED');
      if (bookingStatus !== 'CONFIRMED') {
        return reply.code(409).send({
          error: 'NOT_CONFIRMED',
          message: bookingStatus === 'REQUESTED'
            ? 'Accept this seat request before verifying the boarding code.'
            : 'That booking is not active.',
          booking_status: bookingStatus,
        });
      }

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

      const fareAmount = Number(
        booking.fare_amount ?? (Number(ride?.price_split || 0) * Number(booking?.seats_booked || 1))
      );
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
        const cur = walletDoc.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };
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
          // Completion + dispute state, so the rider UI can offer to finish
          // the ride and show how long they have to challenge it.
          booking_status: b.booking_status ?? 'CONFIRMED',
          completed_at: b.completed_at ?? null,
          disputed: b.disputed === true,
          // Ride snapshot fields
          departure_time: ride?.departure_time ?? null,
          driver_name: ride?.driver_name ?? null,
          driver_phone: ride?.driver_phone ?? null,
          driver_email: ride?.driver_email ?? null,
          driver_photo: ride?.driver_photo ?? null,
          vehicle: ride?.vehicle ?? null,
          vehicle_plate: ride?.vehicle_plate ?? null,
          ride_status: ride?.status ?? null,
          price_split: ride?.price_split ?? null,
          // Where the ride actually goes. The trips list showed a time, a
          // seat count and a fare, but never the route.
          source: ride?.source ?? null,
          destination: ride?.destination ?? null,
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
            let riderPhone: string | null = null;
            let riderEmail: string | null = null;
            let riderPhoto: string | null = null;
            try {
              const u = await db.collection('users').doc(String(b.rider_id)).get();
              if (u.exists) {
                const uData = u.data()!;
                riderName = uData.full_name || uData.name || uData.displayName || 'Rider';
                riderRating = uData.rating_avg ? parseFloat(uData.rating_avg.toFixed(1)) : null;
                riderPhone = uData.phone_number || uData.phone || null;
                riderEmail = uData.email || uData.corporate_email || null;
                riderPhoto = uData.photo_url || uData.photoURL || uData.avatar_path || null;
              }
            } catch { /* name enrichment is best-effort */ }
            return {
              booking_id: d.id,
              rider_id: String(b.rider_id),
              rider_name: riderName,
              rider_phone: riderPhone,
              rider_email: riderEmail,
              rider_photo: riderPhoto,
              rider_rating: riderRating,
              seats_booked: b.seats_booked,
              pickup_point: b.pickup_point ?? null,
              escrow_status: b.escrow_status,
              // Drives the accept/decline controls. Bookings made before
              // approvals existed have no status and were confirmed by
              // definition, so they must not render as pending requests.
              booking_status: b.booking_status ?? 'CONFIRMED',
              // Never the code itself — only whether this rider is verified, so
              // the driver UI can show who still needs to board.
              boarding_verified: b.boarding_verified ?? false,
              // What they are bringing, so the driver can plan boot space and
              // see it again after accepting, not only in the push.
              luggage_note: b.luggage_note ?? null,
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

      // Same resolution as the booking endpoint. When the rider has picked a
      // meeting point the app passes it here, so the breakdown reflects the
      // leg they are actually buying rather than the whole route.
      const qLat = Number((request.query as any).pickup_lat);
      const qLng = Number((request.query as any).pickup_lng);
      const quoteFare = farePerSeatForPickup({
        ridePrice: Number(ride.price_split || 0),
        stops: ride.pickup_points,
        pickupLat: qLat,
        pickupLng: qLng,
      });
      const fare = round2(quoteFare.farePerSeat * seatCount);
      const premium = insurancePremium(Number(ride.distance_km || 0));

      return reply.send({
        ride_id,
        seats: seatCount,
        distance_km: Number(ride.distance_km || 0) || null,
        // Stops the driver said they'd collect from. Offered to the rider
        // alongside the auto-suggested meeting points at checkout.
        pickup_points: Array.isArray(ride.pickup_points) ? ride.pickup_points : [],
        fare_amount: fare,
        // So the app can say "₹200 boarding at Surat" instead of silently
        // showing a smaller number than the ride advertised.
        fare_per_seat: quoteFare.farePerSeat,
        fare_via_stop: quoteFare.isStopFare ? (quoteFare.viaStopLabel ?? 'stop') : null,
        full_journey_fare_per_seat: round2(Number(ride.price_split || 0)),
        convenience_fee: CONVENIENCE_FEE,
        // Optional — only added to the total if the rider opts in.
        insurance_premium: premium,
        insurance_available: premium > 0,
        total_without_insurance: bookingTotal(fare, 0),
        total_with_insurance: bookingTotal(fare, premium),
        // Carried in the quote so the booking screen shows the rules the
        // SERVER holds. Hardcoding them in the app would let two app versions
        // show two different sets of rules while this endpoint recorded the
        // same acknowledgement for both.
        restricted_items: {
          headline: RESTRICTED_ITEMS_HEADLINE,
          items: RESTRICTED_ITEMS,
          ack_label: RESTRICTED_ITEMS_ACK_LABEL,
          footer: RESTRICTED_ITEMS_FOOTER,
        },
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
        const cur = walletDoc.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };

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
            : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };
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
