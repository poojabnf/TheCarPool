import { FastifyInstance } from 'fastify';
import { db } from '../server';

interface SearchQuery {
  query?: string;
}

export async function geoRoutes(fastify: FastifyInstance) {

  // 1. Search for a postal code or place name in Firestore
  fastify.get('/search', async (request, reply) => {
    const { query = '' } = request.query as SearchQuery;

    if (query.trim().length < 2) {
      return reply.send([]);
    }

    try {
      const snap = await db.collection('postal_codes').get();
      const results: any[] = [];
      const lowerQuery = query.toLowerCase();

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

      return reply.send(sortedResults);
    } catch (err: any) {
      fastify.log.error('Geographic search query failed:', err);
      return reply.code(500).send({ error: 'Database failure performing geocoding lookup.' });
    }
  });

  // 2. Get list of active launch countries in Firestore
  fastify.get('/countries', async (request, reply) => {
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
