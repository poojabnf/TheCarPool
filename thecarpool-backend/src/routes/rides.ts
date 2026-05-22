import { FastifyInstance } from 'fastify';
import { dbPool, redisClient } from '../server';

interface CreateRideBody {
  driver_id: number;
  route_geojson: string; // GeoJSON LineString representing route
  seats_total: number;
  price_split: number;
  departure_time: string;
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
}

export async function rideRoutes(fastify: FastifyInstance) {
  
  // 1. Create a ride with LineString geometry
  fastify.post('/', async (request, reply) => {
    const { driver_id, route_geojson, seats_total, price_split, departure_time } = request.body as CreateRideBody;

    try {
      const query = `
        INSERT INTO rides (driver_id, route_line, seats_total, seats_available, price_split, departure_time)
        VALUES (
          $1, 
          ST_GeomFromGeoJSON($2), 
          $3, 
          $3, 
          $4, 
          $5
        )
        RETURNING id, seats_total, price_split, departure_time;
      `;
      const result = await dbPool.query(query, [driver_id, route_geojson, seats_total, price_split, departure_time]);
      return reply.code(201).send(result.rows[0]);
    } catch (err: any) {
      fastify.log.error('Failed to create ride:', err);
      return reply.code(500).send({ error: 'Database failure to register ride route.' });
    }
  });

  // 2. Spatial carpool matching search query with dynamic filters and Redis caching
  fastify.post('/search', async (request, reply) => {
    const body = request.body as SearchRideBody;
    const { 
      pickup_lng, pickup_lat, drop_lng, drop_lat, max_detour_meters = 1500,
      gender_preference, company_domain, society_name, ev_only = false
    } = body;

    // Build Cache Key
    const cacheKey = `search:${JSON.stringify(body)}`;
    
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

      const query = `
        SELECT 
          r.id,
          r.seats_available,
          r.price_split,
          r.departure_time,
          u.name as driver_name,
          u.company_domain as driver_company,
          u.society_name as driver_society,
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
}
