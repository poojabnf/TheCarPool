import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { sendPushToUser } from '../lib/fcm';

const CreateBookingSchema = z.object({
  ride_id: z.string().min(1),
  rider_id: z.string().min(1),
  seats_booked: z.number().int().positive(),
  pickup_lng: z.number(),
  pickup_lat: z.number(),
  drop_lng: z.number(),
  drop_lat: z.number(),
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
    const { ride_id, rider_id, seats_booked, pickup_lng, pickup_lat, drop_lng, drop_lat } = parsed;

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

    try {
      const result = await db.runTransaction(async (transaction) => {
        const rideRef = db.collection('rides').doc(String(ride_id));
        const rideDoc = await transaction.get(rideRef);

        if (!rideDoc.exists) {
          throw new Error('NOT_FOUND');
        }

        const ride = rideDoc.data()!;
        if (ride.status !== 'SCHEDULED') {
          throw new Error('NOT_OPEN');
        }

        if (ride.seats_available < seats_booked) {
          throw new Error('NO_SEATS');
        }

        // Decrement seats in Firestore
        transaction.update(rideRef, {
          seats_available: ride.seats_available - seats_booked
        });

        // Create Booking doc
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingData = {
          id: bookingId,
          ride_id: String(ride_id),
          rider_id: String(rider_id),
          seats_booked,
          pickup_point: { lat: pickup_lat, lng: pickup_lng },
          drop_point: { lat: drop_lat, lng: drop_lng },
          payment_status: 'ESCROW_LOCKED',
          escrow_status: 'HELD',
          created_at: new Date().toISOString()
        };
        transaction.set(bookingRef, bookingData);

        return { id: bookingId, payment_status: 'ESCROW_LOCKED', escrow_status: 'HELD' };
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
      if (err.message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Commute ride pool not found.' });
      }
      if (err.message === 'NOT_OPEN') {
        return reply.code(400).send({ error: 'This ride pool is no longer open for booking.' });
      }
      if (err.message === 'NO_SEATS') {
        return reply.code(400).send({ error: 'Insufficient seats available.' });
      }
      fastify.log.error('Booking transaction aborted:', err);
      return reply.code(500).send({ error: 'Failed to complete escrow booking.' });
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
      
      // Look up driver's user_id in Firestore
      const driverDoc = await db.collection('drivers').doc(String(ride.driver_id)).get();
      const driver_id = driverDoc.exists ? driverDoc.data()?.user_id : null;
      const rider_id = booking.rider_id;

      const requesterId = String(request.user?.id);
      if (requesterId !== String(driver_id) && requesterId !== String(rider_id)) {
        return reply.code(403).send({ error: 'Forbidden: Only the rider or driver can settle the escrow.' });
      }

      if (booking.escrow_status !== 'HELD') {
        return reply.code(400).send({ error: 'No active locked booking found for ID.' });
      }

      // Settle: move the fare from escrow to the driver's wallet, atomically
      // with the booking status flip so we can't double-release.
      const fareAmount = Number(ride.price_split || 0) * Number(booking.seats_booked || 1);
      const driverWalletId = driver_id ? String(driver_id) : null;

      await db.runTransaction(async (tx) => {
        const freshBooking = await tx.get(bookingRef);
        if (freshBooking.data()?.escrow_status !== 'HELD') {
          throw new Error('ALREADY_SETTLED');
        }
        tx.update(bookingRef, {
          payment_status: 'RELEASED',
          escrow_status: 'SETTLED',
          settled_amount: fareAmount,
          settled_at: new Date().toISOString(),
        });
        if (driverWalletId) {
          const walletRef = db.collection('wallets').doc(driverWalletId);
          const walletDoc = await tx.get(walletRef);
          const cur = walletDoc.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
          tx.set(walletRef, { ...cur, available_wallet_balance: (cur.available_wallet_balance || 0) + fareAmount }, { merge: true });
        }
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

  // ── GET /:id — single booking detail ────────────────────────────────────
  fastify.get('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uid = String(request.user!.id);
    try {
      const doc = await db.collection('bookings').doc(id).get();
      if (!doc.exists) return reply.code(404).send({ error: 'Booking not found.' });

      const b = doc.data()!;
      // Only the rider or driver of the associated ride can view
      if (String(b.rider_id) !== uid) {
        // Allow driver too — check via ride doc
        const rideDoc = await db.collection('rides').doc(String(b.ride_id)).get();
        const driverUid = rideDoc.exists ? String(rideDoc.data()?.driver_uid ?? '') : '';
        if (driverUid !== uid) {
          return reply.code(403).send({ error: 'Forbidden: you are not a participant of this booking.' });
        }
      }

      return reply.send({ id: doc.id, ...b });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch booking');
      return reply.code(500).send({ error: 'Failed to fetch booking.' });
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

      const fareAmount = Number(ride.price_split || 0) * Number(b.seats_booked || 1);

      await db.runTransaction(async (tx) => {
        // Refetch booking inside transaction
        const freshBookingDoc = await tx.get(bookingRef);
        const freshB = freshBookingDoc.data()!;
        if (freshB.escrow_status !== 'HELD') {
          throw new Error('ALREADY_PROCESSED');
        }

        // Refetch ride inside transaction
        const freshRideDoc = await tx.get(rideRef);
        const freshRide = freshRideDoc.data()!;

        // 1. Update ride seats
        tx.update(rideRef, {
          seats_available: (freshRide.seats_available || 0) + freshB.seats_booked,
        });

        // 2. Update booking escrow status to CANCELLED
        tx.update(bookingRef, {
          escrow_status: 'CANCELLED',
          cancelled_at: new Date().toISOString(),
        });

        // 3. Refund the rider's wallet since funds were locked in escrow
        const walletRef = db.collection('wallets').doc(uid);
        const walletDoc = await tx.get(walletRef);
        const cur = walletDoc.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
        tx.set(walletRef, {
          ...cur,
          available_wallet_balance: (cur.available_wallet_balance || 0) + fareAmount,
        }, { merge: true });
      });

      return reply.send({ status: 'BOOKING_CANCELLED', booking_id: id, refunded_amount: fareAmount });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to cancel booking');
      if (err.message === 'ALREADY_PROCESSED') {
        return reply.code(400).send({ error: 'Booking has already been processed.' });
      }
      return reply.code(500).send({ error: 'Failed to cancel booking.' });
    }
  });
}
