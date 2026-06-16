import { FastifyInstance } from 'fastify';
import { db, storage } from '../server';
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

  // 3. Generate a signed URL to upload a listing image (owner-bound path)
  fastify.post('/:id/image', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as any) || {};
    const filename = (body.filename || `img_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '');
    const content_type = body.content_type || 'image/jpeg';
    const uid = request.user!.id;

    try {
      // Verify the listing exists and belongs to the requesting user.
      const doc = await db.collection('classifieds').doc(id).get();
      if (!doc.exists) {
        return reply.code(404).send({ error: 'Classified listing not found.' });
      }
      if (String(doc.data()?.user_id) !== String(uid)) {
        return reply.code(403).send({ error: 'Forbidden: you can only add images to your own listing.' });
      }

      const bucket = storage.bucket();
      const file = bucket.file(`users/${uid}/classifieds/${id}/${Date.now()}_${filename}`);
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: content_type,
      });

      return reply.code(201).send({
        status: 'SIGNED_UPLOAD_URL_GENERATED',
        bucket: bucket.name,
        file_key: file.name,
        upload_url: uploadUrl,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to generate classified image upload URL');
      return reply.code(500).send({ error: 'Failed to initialize image upload.' });
    }
  });
}
