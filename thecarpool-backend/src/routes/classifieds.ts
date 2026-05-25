import { FastifyInstance } from 'fastify';
import { dbPool } from '../server';
import { requireAuth } from '../middleware/auth';

interface CreateClassifiedBody {
  title: string;
  description: string;
  category: 'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE' | 'OTHER';
  price?: number;
}

export async function classifiedRoutes(fastify: FastifyInstance) {
  
  // 1. Get all active classifieds with poster profiles (POOLit Classifieds Gap)
  fastify.get('/', async (request, reply) => {
    const { category } = request.query as { category?: string };

    try {
      let query = `
        SELECT 
          c.id,
          c.title,
          c.description,
          c.category,
          c.price,
          c.created_at,
          u.name as poster_name,
          u.company_domain as poster_company,
          u.society_name as poster_society,
          u.linkedin_profile_url,
          u.linkedin_connections
        FROM classifieds c
        JOIN users u ON c.user_id = u.id
      `;
      const queryParams: any[] = [];

      if (category) {
        queryParams.push(category);
        query += ` WHERE c.category = $1`;
      }

      query += ` ORDER BY c.created_at DESC;`;

      const result = await dbPool.query(query, queryParams);
      return reply.send(result.rows);
    } catch (err: any) {
      fastify.log.error('Failed to fetch classifieds listings:', err);
      return reply.code(500).send({ error: 'Failed to retrieve community classifieds.' });
    }
  });

  // 2. Create a new classified listing
  fastify.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const { title, description, category, price } = request.body as CreateClassifiedBody;
    const userId = request.user?.id;

    if (!title || !description || !category) {
      return reply.code(400).send({ error: 'Title, description and category are required.' });
    }

    try {
      const query = `
        INSERT INTO classifieds (user_id, title, description, category, price)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, title, description, category, price, created_at;
      `;
      const result = await dbPool.query(query, [userId, title, description, category, price || null]);
      return reply.code(201).send(result.rows[0]);
    } catch (err: any) {
      fastify.log.error('Failed to post classified:', err);
      return reply.code(500).send({ error: 'Database failure to register classified post.' });
    }
  });
}
