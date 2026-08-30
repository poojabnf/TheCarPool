import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { db } from '../lib/firestore';
import { requireAuth } from '../middleware/auth';

export const notificationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Get in-app notifications inbox for the current user
  fastify.get('/mine', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const uid = String(request.user!.id);
      const snap = await db
        .collection('notifications')
        .where('user_id', '==', uid)
        .orderBy('created_at', 'desc')
        .limit(50)
        .get();

      const items = snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const unreadCount = items.filter((item: any) => !item.read).length;

      return reply.send({ notifications: items, unreadCount });
    } catch (err: any) {
      fastify.log.error({ err }, 'Failed to fetch user in-app notifications');
      return reply.status(500).send({ error: 'Failed to load notifications' });
    }
  });

  // Mark all or specific notifications as read
  fastify.post('/mark-read', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const uid = String(request.user!.id);
      const { id } = (request.body as any) || {};

      if (id) {
        await db.collection('notifications').doc(id).update({
          read: true,
          read_at: new Date().toISOString(),
        });
      } else {
        const snap = await db
          .collection('notifications')
          .where('user_id', '==', uid)
          .where('read', '==', false)
          .get();

        const batch = db.batch();
        snap.docs.forEach((doc) => {
          batch.update(doc.ref, { read: true, read_at: new Date().toISOString() });
        });
        await batch.commit();
      }

      return reply.send({ success: true });
    } catch (err: any) {
      fastify.log.error({ err }, 'Failed to mark notifications read');
      return reply.status(500).send({ error: 'Failed to mark notifications read' });
    }
  });
};
