import { FastifyInstance } from 'fastify';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';

interface CreateClassifiedBody {
  title: string;
  description: string;
  category: 'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE' | 'OTHER';
  price?: number;
}

export async function classifiedRoutes(fastify: FastifyInstance) {
  
  // 1. Get all active classifieds with poster profiles from Firestore
  fastify.get('/', async (request, reply) => {
    const { category } = request.query as { category?: string };

    try {
      let queryRef: any = db.collection('classifieds');

      if (category) {
        queryRef = queryRef.where('category', '==', category);
      }

      const snap = await queryRef.get();
      const listings: any[] = [];

      for (const doc of snap.docs) {
        const cData = doc.data();
        
        // Fetch poster user profile in Firestore
        const userDoc = await db.collection('users').doc(String(cData.user_id)).get();
        const uData = userDoc.exists ? userDoc.data() : null;

        listings.push({
          id: doc.id,
          title: cData.title,
          description: cData.description,
          category: cData.category,
          price: cData.price,
          created_at: cData.created_at,
          poster_name: uData?.name || 'Anonymous',
          poster_company: uData?.company_domain || null,
          poster_society: uData?.society_name || null,
          linkedin_profile_url: uData?.linkedin_profile_url || null,
          linkedin_connections: uData?.linkedin_connections || 0
        });
      }

      // Sort in memory by created_at DESC
      listings.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return reply.send(listings);
    } catch (err: any) {
      fastify.log.error('Failed to fetch classifieds listings:', err);
      return reply.code(500).send({ error: 'Failed to retrieve community classifieds.' });
    }
  });

  // 2. Create a new classified listing in Firestore
  fastify.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const { title, description, category, price } = request.body as CreateClassifiedBody;
    const userId = request.user?.id;

    if (!title || !description || !category) {
      return reply.code(400).send({ error: 'Title, description and category are required.' });
    }

    try {
      const id = 'classified_' + Math.random().toString(36).substring(7);
      const newClassified = {
        id,
        user_id: String(userId),
        title,
        description,
        category,
        price: price || null,
        created_at: new Date().toISOString()
      };

      await db.collection('classifieds').doc(id).set(newClassified);
      return reply.code(201).send(newClassified);
    } catch (err: any) {
      fastify.log.error('Failed to post classified:', err);
      return reply.code(500).send({ error: 'Database failure to register classified post.' });
    }
  });
}
