import { FastifyInstance } from 'fastify';
import { db, redisClient } from '../server';
import { requireAuth } from '../middleware/auth';

interface SearchQuery {
  query?: string;
}

export async function geoRoutes(fastify: FastifyInstance) {

  // 1. Search for a postal code or place name in Firestore
  fastify.get('/search', { preHandler: [requireAuth] }, async (request, reply) => {
    const { query = '' } = request.query as SearchQuery;

    if (query.trim().length < 2) {
      return reply.send([]);
    }

    const lowerQuery = query.toLowerCase().trim();
    const cacheKey = `geo:search:${lowerQuery}`;

    try {
      // Cache-aside: geocoding results are highly repetitive, so cache them.
      if (redisClient.isOpen) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return reply.send(JSON.parse(cached));
        }
      }

      const snap = await db.collection('postal_codes').get();
      const results: any[] = [];

      snap.forEach(doc => {
        const data = doc.data();
        if (
          (data.postal_code && data.postal_code.toLowerCase().includes(lowerQuery)) ||
          (data.place_name && data.place_name.toLowerCase().includes(lowerQuery))
        ) {
          results.push({
            id: doc.id,
            postal_code: data.postal_code,
            place_name: data.place_name,
            state_name: data.state_name,
            state_code: data.state_code,
            country_name: data.country_name,
            country_iso: data.country_iso,
            longitude: data.location?.lng ?? data.location?.longitude ?? 0,
            latitude: data.location?.lat ?? data.location?.latitude ?? 0
          });
        }
      });

      const sortedResults = results
        .sort((a, b) => a.postal_code.localeCompare(b.postal_code))
        .slice(0, 10);

      // Cache for 5 minutes — postal code data is effectively static.
      if (redisClient.isOpen) {
        redisClient.setEx(cacheKey, 300, JSON.stringify(sortedResults)).catch(err => {
          fastify.log.error('Redis geo cache write failed:', err);
        });
      }

      return reply.send(sortedResults);
    } catch (err: any) {
      fastify.log.error('Geographic search query failed:', err);
      return reply.code(500).send({ error: 'Database failure performing geocoding lookup.' });
    }
  });

  // 2. Get list of active launch countries in Firestore
  fastify.get('/countries', { preHandler: [requireAuth] }, async (request, reply) => {
    try {
      const snap = await db.collection('countries').get();
      const results: any[] = [];
      snap.forEach(doc => {
        results.push({
          id: doc.id,
          ...doc.data()
        });
      });
      results.sort((a, b) => a.name.localeCompare(b.name));
      return reply.send(results);
    } catch (err: any) {
      fastify.log.error('Failed to list countries:', err);
      return reply.code(500).send({ error: 'Database failure listing countries.' });
    }
  });
}
