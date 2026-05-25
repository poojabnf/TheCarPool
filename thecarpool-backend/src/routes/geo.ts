import { FastifyInstance } from 'fastify';
import { dbPool } from '../server';

interface SearchQuery {
  query?: string;
}

export async function geoRoutes(fastify: FastifyInstance) {

  // 1. Search for a postal code or place name
  fastify.get('/search', async (request, reply) => {
    const { query = '' } = request.query as SearchQuery;

    if (query.trim().length < 2) {
      return reply.send([]);
    }

    try {
      const dbQuery = `
        SELECT 
          pc.id,
          pc.postal_code, 
          pc.place_name, 
          s.name as state_name, 
          s.code as state_code,
          c.name as country_name, 
          c.iso_code as country_iso,
          ST_X(pc.location) as longitude, 
          ST_Y(pc.location) as latitude
        FROM postal_codes pc
        JOIN states s ON pc.state_id = s.id
        JOIN countries c ON s.country_id = c.id
        WHERE pc.postal_code ILIKE $1 
           OR pc.place_name ILIKE $2
        ORDER BY pc.postal_code ASC
        LIMIT 10;
      `;
      
      const likePattern = `%${query}%`;
      const result = await dbPool.query(dbQuery, [likePattern, likePattern]);
      
      return reply.send(result.rows);
    } catch (err: any) {
      fastify.log.error('Geographic search query failed:', err);
      return reply.code(500).send({ error: 'Database failure performing geocoding lookup.' });
    }
  });

  // 2. Get list of active launch countries
  fastify.get('/countries', async (request, reply) => {
    try {
      const result = await dbPool.query(
        'SELECT id, name, iso_code, phone_code, currency FROM countries ORDER BY name ASC'
      );
      return reply.send(result.rows);
    } catch (err: any) {
      fastify.log.error('Failed to list countries:', err);
      return reply.code(500).send({ error: 'Database failure listing countries.' });
    }
  });
}
