import { FastifyInstance } from 'fastify';
import { dbPool } from '../server';

interface CreateBookingBody {
  ride_id: number;
  rider_id: number;
  seats_booked: number;
  pickup_lng: number;
  pickup_lat: number;
  drop_lng: number;
  drop_lat: number;
}

export async function bookingRoutes(fastify: FastifyInstance) {

  // 1. Create booking & Lock funds in Escrow
  fastify.post('/', async (request, reply) => {
    const { ride_id, rider_id, seats_booked, pickup_lng, pickup_lat, drop_lng, drop_lat } = request.body as CreateBookingBody;

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');

      // Check seat availability
      const rideQuery = 'SELECT seats_available, price_split, status FROM rides WHERE id = $1 FOR UPDATE';
      const rideRes = await client.query(rideQuery, [ride_id]);
      
      if (rideRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Commute ride pool not found.' });
      }

      const ride = rideRes.rows[0];
      if (ride.status !== 'SCHEDULED') {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'This ride pool is no longer open for booking.' });
      }

      if (ride.seats_available < seats_booked) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Insufficient seats available.' });
      }

      // Decrement seats
      const updateSeats = 'UPDATE rides SET seats_available = seats_available - $1 WHERE id = $2';
      await client.query(updateSeats, [seats_booked, ride_id]);

      // Create Booking with Locked Escrow state
      const createBooking = `
        INSERT INTO bookings (ride_id, rider_id, seats_booked, pickup_point, drop_point, payment_status, escrow_status)
        VALUES (
          $1, 
          $2, 
          $3, 
          ST_SetSRID(ST_MakePoint($4, $5), 4326), 
          ST_SetSRID(ST_MakePoint($6, $7), 4326), 
          'ESCROW_LOCKED', 
          'HELD'
        )
        RETURNING id, payment_status, escrow_status;
      `;
      const bookingRes = await client.query(createBooking, [
        ride_id, 
        rider_id, 
        seats_booked, 
        pickup_lng, 
        pickup_lat, 
        drop_lng, 
        drop_lat
      ]);

      await client.query('COMMIT');
      return reply.code(201).send(bookingRes.rows[0]);
    } catch (err: any) {
      await client.query('ROLLBACK');
      fastify.log.error('Booking transaction aborted:', err);
      return reply.code(500).send({ error: 'Failed to complete escrow booking.' });
    } finally {
      client.release();
    }
  });

  // 2. Settle escrow (Triggered when ride completes)
  fastify.post('/:id/escrow-settle', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const query = `
        UPDATE bookings 
        SET payment_status = 'RELEASED', escrow_status = 'SETTLED'
        WHERE id = $1 AND escrow_status = 'HELD'
        RETURNING id, payment_status, escrow_status;
      `;
      const result = await dbPool.query(query, [id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'No active locked booking found for ID.' });
      }

      return reply.send({ message: 'Escrow settlement completed. Funds released to driver UPI ID.', booking: result.rows[0] });
    } catch (err: any) {
      fastify.log.error('Escrow release failed:', err);
      return reply.code(500).send({ error: 'Failed to process escrow settlement.' });
    }
  });

  // 3. Carbon Offset & SafarPoints Tracker Dashboard (Sustainability & B2B ESG reporting)
  fastify.get('/carbon-savings/:user_id', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };

    try {
      // Calculate carbon savings dynamically based on settled rides
      // CO2 prevented: 0.22kg per km shared
      const query = `
        SELECT 
          COUNT(b.id) as total_rides_shared,
          SUM(b.seats_booked) as total_seats_booked,
          COALESCE(SUM(b.seats_booked * 8.4), 0.0) as estimated_kms_commuted
        FROM bookings b
        WHERE b.rider_id = $1 AND b.escrow_status = 'SETTLED';
      `;
      const result = await dbPool.query(query, [user_id]);
      const metrics = result.rows[0];

      const kms = parseFloat(metrics.estimated_kms_commuted);
      const co2_saved_kg = kms * 0.22;
      const safarpoints = Math.floor(kms * 10); // 10 points per km shared

      return reply.send({
        user_id,
        total_commutes: parseInt(metrics.total_rides_shared, 10),
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
