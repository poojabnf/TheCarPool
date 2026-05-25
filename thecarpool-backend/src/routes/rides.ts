import { FastifyInstance } from 'fastify';
import { dbPool, redisClient } from '../server';
import { requireAuth } from '../middleware/auth';

interface CreateRideBody {
  driver_id: number;
  route_geojson: string; // GeoJSON LineString representing route
  seats_total: number;
  price_split: number;
  departure_time: string;
  vehicle_type?: 'CAR' | 'BIKE';
  music_allowed?: boolean;
  smoking_allowed?: boolean;
  chattiness?: 'QUIET' | 'MEDIUM' | 'TALKATIVE';
  ac_available?: boolean;
}

interface SearchRideBody {
  pickup_lng: number;
  pickup_lat: number;
  drop_lng: number;
  drop_lat: number;
  max_detour_meters?: number;
  gender_preference?: 'MALE' | 'FEMALE' | 'ANY';
  company_domain?: string;
  society_name?: string;
  ev_only?: boolean;
  vehicle_type?: 'CAR' | 'BIKE' | 'ANY';
  music_allowed?: boolean;
  smoking_allowed?: boolean;
  chattiness?: 'QUIET' | 'MEDIUM' | 'TALKATIVE' | 'ANY';
  ac_available?: boolean;
}

export async function rideRoutes(fastify: FastifyInstance) {
  
  // 1. Create a ride with LineString geometry
  fastify.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const { 
      driver_id, route_geojson, seats_total, price_split, departure_time,
      vehicle_type = 'CAR', music_allowed = true, smoking_allowed = false,
      chattiness = 'MEDIUM', ac_available = true
    } = request.body as CreateRideBody;

    try {
      // Verify the user is the driver
      const driverQuery = 'SELECT user_id FROM drivers WHERE id = $1';
      const driverRes = await dbPool.query(driverQuery, [driver_id]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].user_id !== request.user?.id) {
        return reply.code(403).send({ error: 'Forbidden: You do not own this driver profile.' });
      }

      const query = `
        INSERT INTO rides (
          driver_id, route_line, seats_total, seats_available, price_split, departure_time,
          vehicle_type, music_allowed, smoking_allowed, chattiness, ac_available
        )
        VALUES (
          $1, 
          ST_GeomFromGeoJSON($2), 
          $3, 
          $3, 
          $4, 
          $5,
          $6, $7, $8, $9, $10
        )
        RETURNING id, seats_total, price_split, departure_time, vehicle_type;
      `;
      const result = await dbPool.query(query, [
        driver_id, route_geojson, seats_total, price_split, departure_time,
        vehicle_type, music_allowed, smoking_allowed, chattiness, ac_available
      ]);
      return reply.code(201).send(result.rows[0]);
    } catch (err: any) {
      fastify.log.error('Failed to create ride:', err);
      return reply.code(500).send({ error: 'Database failure to register ride route.' });
    }
  });

  // 2. Spatial carpool matching search query with dynamic filters and Redis caching
  fastify.post('/search', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = request.body as SearchRideBody;
    const { 
      pickup_lng, pickup_lat, drop_lng, drop_lat, max_detour_meters = 1500,
      gender_preference, company_domain, society_name, ev_only = false,
      vehicle_type = 'ANY', music_allowed, smoking_allowed, chattiness = 'ANY', ac_available
    } = body;

    // Validate bounds
    if (pickup_lat > 90 || pickup_lat < -90 || drop_lat > 90 || drop_lat < -90 || pickup_lng > 180 || pickup_lng < -180 || drop_lng > 180 || drop_lng < -180) {
      return reply.code(400).send({ error: 'Invalid coordinates' });
    }

    // Build Cache Key securely
    const cacheKey = `search:${pickup_lng},${pickup_lat},${drop_lng},${drop_lat},${max_detour_meters},${gender_preference || 'ANY'},${company_domain || 'NONE'},${society_name || 'NONE'},${ev_only},${vehicle_type},${music_allowed ?? 'ANY'},${smoking_allowed ?? 'ANY'},${chattiness},${ac_available ?? 'ANY'}`;
    
    try {
      // 1. Check Redis Cache
      if (redisClient.isOpen) {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          fastify.log.info(`[CACHE HIT] Returning matched routes for: ${cacheKey}`);
          return reply.send(JSON.parse(cachedData));
        }
      }

      const queryParams: any[] = [pickup_lng, pickup_lat, drop_lng, drop_lat, max_detour_meters];
      
      let dynamicFilters = '';

      if (gender_preference && gender_preference !== 'ANY') {
        queryParams.push(gender_preference);
        dynamicFilters += ` AND u.gender = $${queryParams.length}`;
      }

      if (company_domain) {
        queryParams.push(company_domain);
        dynamicFilters += ` AND u.company_domain = $${queryParams.length}`;
      }

      if (society_name) {
        queryParams.push(society_name);
        dynamicFilters += ` AND u.society_name = $${queryParams.length}`;
      }

      if (ev_only) {
        dynamicFilters += ` AND d.is_ev = true`;
      }

      if (vehicle_type && vehicle_type !== 'ANY') {
        queryParams.push(vehicle_type);
        dynamicFilters += ` AND r.vehicle_type = $${queryParams.length}`;
      }

      if (music_allowed !== undefined) {
        queryParams.push(music_allowed);
        dynamicFilters += ` AND r.music_allowed = $${queryParams.length}`;
      }

      if (smoking_allowed !== undefined) {
        queryParams.push(smoking_allowed);
        dynamicFilters += ` AND r.smoking_allowed = $${queryParams.length}`;
      }

      if (chattiness && chattiness !== 'ANY') {
        queryParams.push(chattiness);
        dynamicFilters += ` AND r.chattiness = $${queryParams.length}`;
      }

      if (ac_available !== undefined) {
        queryParams.push(ac_available);
        dynamicFilters += ` AND r.ac_available = $${queryParams.length}`;
      }

      const query = `
        SELECT 
          r.id,
          r.seats_available,
          r.price_split,
          r.departure_time,
          r.vehicle_type,
          r.music_allowed,
          r.smoking_allowed,
          r.chattiness,
          r.ac_available,
          u.name as driver_name,
          u.company_domain as driver_company,
          u.society_name as driver_society,
          u.linkedin_profile_url,
          u.linkedin_connections,
          d.is_ev,
          ST_Distance(r.route_line::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as pickup_deviation,
          ST_Distance(r.route_line::geography, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography) as drop_deviation
        FROM rides r
        JOIN drivers d ON r.driver_id = d.id
        JOIN users u ON d.user_id = u.id
        WHERE 
          r.status = 'SCHEDULED'
          AND r.seats_available > 0
          -- Check pickup is within detour buffer zone
          AND ST_DWithin(r.route_line::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5)
          -- Check drop is within detour buffer zone
          AND ST_DWithin(r.route_line::geography, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
          -- Ensure direction correctness: pickup point occurs before drop point along driver path
          AND ST_LineLocatePoint(r.route_line, ST_SetSRID(ST_MakePoint($1, $2), 4326)) < ST_LineLocatePoint(r.route_line, ST_SetSRID(ST_MakePoint($3, $4), 4326))
          ${dynamicFilters}
        ORDER BY (pickup_deviation + drop_deviation) ASC;
      `;

      const result = await dbPool.query(query, queryParams);
      
      // 2. Set Cache asynchronously (Expire in 60 seconds)
      if (redisClient.isOpen) {
        redisClient.setEx(cacheKey, 60, JSON.stringify(result.rows)).catch(err => {
          fastify.log.error('Redis cache write failed:', err);
        });
      }

      return reply.send(result.rows);
    } catch (err: any) {
      fastify.log.error('Spatial matching query failed:', err);
      return reply.code(500).send({ error: 'Failed to perform spatial routing match calculation.' });
    }
  });

  // 3. Multi-modal / Transit Stitching Engine stub
  fastify.post('/search/stitch', async (request, reply) => {
    const { pickup_lng, pickup_lat, drop_lng, drop_lat } = request.body as any;
    
    // Fallback: If no pure carpools match directly, stitch carpool to nearest metro station
    return reply.send({
      mode: 'STITCHED',
      leg1: {
        type: 'CARPOOL',
        to: 'IFFCO Chowk Metro Station',
        duration_mins: 12,
        cost: 45.00
      },
      leg2: {
        type: 'METRO',
        from: 'IFFCO Chowk',
        to: 'DLF Cyber City',
        duration_mins: 18,
        cost: 20.00
      }
    });
  });

  // 4. Create a recurring ride schedule (Quick Ride "Repeat Ride" Gap)
  fastify.post('/recurring', { preHandler: [requireAuth] }, async (request, reply) => {
    const { 
      driver_id, route_geojson, seats_total, price_split, 
      departure_time_of_day, days_of_week, vehicle_type = 'CAR'
    } = request.body as {
      driver_id: number;
      route_geojson: string;
      seats_total: number;
      price_split: number;
      departure_time_of_day: string;
      days_of_week: number[];
      vehicle_type?: 'CAR' | 'BIKE';
    };

    try {
      // Verify user is driver
      const driverQuery = 'SELECT user_id FROM drivers WHERE id = $1';
      const driverRes = await dbPool.query(driverQuery, [driver_id]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].user_id !== request.user?.id) {
        return reply.code(403).send({ error: 'Forbidden: You do not own this driver profile.' });
      }

      const query = `
        INSERT INTO recurring_rides (
          driver_id, route_line, seats_total, price_split, 
          departure_time_of_day, days_of_week, vehicle_type
        )
        VALUES (
          $1, ST_GeomFromGeoJSON($2), $3, $4, $5, $6, $7
        )
        RETURNING id, seats_total, price_split, departure_time_of_day, days_of_week, vehicle_type;
      `;
      const result = await dbPool.query(query, [
        driver_id, route_geojson, seats_total, price_split, 
        departure_time_of_day, days_of_week, vehicle_type
      ]);
      return reply.code(201).send(result.rows[0]);
    } catch (err: any) {
      fastify.log.error('Failed to create recurring ride:', err);
      return reply.code(500).send({ error: 'Database failure to register recurring ride.' });
    }
  });

  // 5. Get recurring rides
  fastify.get('/recurring', { preHandler: [requireAuth] }, async (request, reply) => {
    const { driver_id } = request.query as { driver_id?: string };

    try {
      let query = 'SELECT id, driver_id, seats_total, price_split, departure_time_of_day, days_of_week, vehicle_type FROM recurring_rides';
      const params: any[] = [];

      if (driver_id) {
        query += ' WHERE driver_id = $1';
        params.push(parseInt(driver_id, 10));
      }

      const result = await dbPool.query(query, params);
      return reply.send(result.rows);
    } catch (err: any) {
      fastify.log.error('Failed to fetch recurring rides:', err);
      return reply.code(500).send({ error: 'Failed to fetch recurring rides.' });
    }
  });
}
