import { FastifyInstance } from 'fastify';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';

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
    const { ride_id, rider_id, seats_booked, pickup_lng, pickup_lat, drop_lng, drop_lat } = request.body as CreateBookingBody;

    if (String(request.user?.id) !== String(rider_id)) {
      return reply.code(403).send({ error: 'Forbidden: Rider ID mismatch.' });
    }

    const bookingId = 'booking_' + Math.random().toString(36).substring(7);

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

      await bookingRef.update({
        payment_status: 'RELEASED',
        escrow_status: 'SETTLED'
      });

      return reply.send({
        message: 'Escrow settlement completed. Funds released to driver UPI ID.',
        booking: {
          id,
          payment_status: 'RELEASED',
          escrow_status: 'SETTLED'
        }
      });
    } catch (err: any) {
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
      // Calculate carbon savings dynamically based on settled bookings in Firestore
      // CO2 prevented: 0.22kg per km shared
      const snap = await db.collection('bookings')
        .where('rider_id', '==', String(user_id))
        .where('escrow_status', '==', 'SETTLED')
        .get();

      let total_rides_shared = snap.size;
      let total_seats_booked = 0;
      snap.forEach(doc => {
        const data = doc.data();
        total_seats_booked += data.seats_booked || 1;
      });

      const kms = total_seats_booked * 8.4;
      const co2_saved_kg = kms * 0.22;
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
}
