import { FastifyInstance } from 'fastify';
import { db, storage } from '../server';
import { requireAuth, requireAdmin } from '../middleware/auth';

const AVATAR_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // signed read URLs last 7 days; refreshed on /me + upload

interface ProfileBody {
  name?: string;
  displayName?: string;
  company?: string;
  employeeId?: string;
  workLocation?: string;
  role?: 'rider' | 'partner';
  gender?: string;
  corporate_email?: string;
  vehicle_type?: string;
  notifications_enabled?: boolean;
}

// Whitelist of profile fields a client is allowed to set on their own doc.
const ALLOWED_FIELDS: (keyof ProfileBody)[] = [
  'name', 'displayName', 'company', 'employeeId', 'workLocation',
  'role', 'gender', 'corporate_email', 'vehicle_type', 'notifications_enabled',
];

export async function userRoutes(fastify: FastifyInstance) {

  // Return the current user's profile (incl. the server-side onboarded flag).
  fastify.get('/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = request.user!.id;
    try {
      const doc = await db.collection('users').doc(uid).get();
      if (!doc.exists) {
        return reply.send({ id: uid, onboarded: false, profile: null });
      }
      const data = doc.data()!;
      // Refresh the avatar's signed read URL so it never goes stale.
      let photo_url = data.photo_url;
      if (data.avatar_path) {
        try {
          const [url] = await storage.bucket().file(data.avatar_path).getSignedUrl({
            version: 'v4', action: 'read', expires: Date.now() + AVATAR_URL_TTL_MS,
          });
          photo_url = url;
        } catch { /* fall back to the stored URL */ }
      }
      return reply.send({ id: uid, onboarded: data.onboarded === true, ...data, photo_url });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to load user profile');
      return reply.code(500).send({ error: 'Failed to load profile.' });
    }
  });

  // Upload / replace the user's profile photo (base64 JPEG/PNG from the app's
  // camera or gallery). Stored in Storage; a fresh signed read URL is returned.
  fastify.post('/photo', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = request.user!.id;
    const { image_base64, content_type } = (request.body as { image_base64?: string; content_type?: string }) || {};
    if (!image_base64) {
      return reply.code(400).send({ error: 'image_base64 is required.' });
    }
    try {
      const buffer = Buffer.from(image_base64, 'base64');
      if (buffer.length > 6 * 1024 * 1024) {
        return reply.code(413).send({ error: 'Image too large (max 6MB).' });
      }
      const file = storage.bucket().file(`users/${uid}/avatar.jpg`);
      await file.save(buffer, {
        contentType: content_type || 'image/jpeg',
        resumable: false,
        metadata: { cacheControl: 'private, max-age=0' },
      });
      const [photo_url] = await file.getSignedUrl({
        version: 'v4', action: 'read', expires: Date.now() + AVATAR_URL_TTL_MS,
      });
      await db.collection('users').doc(uid).set(
        { avatar_path: file.name, photo_url, photo_updated_at: new Date().toISOString() },
        { merge: true }
      );
      return reply.send({ photo_url });
    } catch (err: any) {
      fastify.log.error(err, 'Avatar upload failed');
      return reply.code(500).send({ error: 'Failed to upload photo.' });
    }
  });

  // Persist onboarding profile data and mark the account as onboarded.
  fastify.post('/profile', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = request.user!.id;
    const body = (request.body as ProfileBody) || {};

    // Only persist whitelisted fields that were actually provided.
    const updates: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    updates.onboarded = true;
    updates.updated_at = new Date().toISOString();

    try {
      await db.collection('users').doc(uid).set(updates, { merge: true });
      return reply.send({ status: 'PROFILE_SAVED', user_id: uid, onboarded: true });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to save user profile');
      return reply.code(500).send({ error: 'Failed to save profile.' });
    }
  });

  // Register a device push token for the authenticated user (FCM targeting).
  fastify.post('/push-token', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = request.user!.id;
    const { token, platform } = request.body as { token?: string; platform?: string };
    if (!token) {
      return reply.code(400).send({ error: 'token is required.' });
    }
    try {
      await db.collection('users').doc(uid).set({
        push_tokens: { [token]: { platform: platform || 'unknown', updated_at: new Date().toISOString() } },
      }, { merge: true });
      return reply.send({ status: 'TOKEN_REGISTERED' });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to register push token');
      return reply.code(500).send({ error: 'Failed to register push token.' });
    }
  });

  // ── Admin endpoints ──────────────────────────────────────────────

  // List all users (admin only).
  fastify.get('/admin/list', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const snap = await db.collection('users').limit(500).get();
      const users = snap.docs.map((d) => {
        const u = d.data();
        return {
          id: d.id,
          name: u.name || null,
          email: u.email || null,
          company_domain: u.company_domain || null,
          kyc_status: u.kyc_status || 'NONE',
          onboarded: u.onboarded === true,
          created_at: u.created_at || null,
        };
      });
      return reply.send(users);
    } catch (err: any) {
      fastify.log.error(err, 'Admin user list failed');
      return reply.code(500).send({ error: 'Failed to list users.' });
    }
  });

  // List users awaiting KYC approval (admin only).
  fastify.get('/admin/kyc-pending', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const snap = await db.collection('users').limit(500).get();
      const pending = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((u) => (u.kyc_status || 'NONE') !== 'VERIFIED')
        .map((u) => ({ id: u.id, name: u.name || null, email: u.email || null, kyc_status: u.kyc_status || 'NONE' }));
      return reply.send(pending);
    } catch (err: any) {
      fastify.log.error(err, 'Admin KYC pending list failed');
      return reply.code(500).send({ error: 'Failed to list pending KYC.' });
    }
  });

  // Approve or reject a user's KYC (admin only).
  fastify.post('/admin/:id/kyc', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { decision } = request.body as { decision?: 'VERIFIED' | 'REJECTED' };
    if (decision !== 'VERIFIED' && decision !== 'REJECTED') {
      return reply.code(400).send({ error: "decision must be 'VERIFIED' or 'REJECTED'." });
    }
    try {
      await db.collection('users').doc(id).set({ kyc_status: decision, kyc_reviewed_at: new Date().toISOString() }, { merge: true });
      return reply.send({ status: 'KYC_UPDATED', user_id: id, kyc_status: decision });
    } catch (err: any) {
      fastify.log.error(err, 'Admin KYC decision failed');
      return reply.code(500).send({ error: 'Failed to update KYC status.' });
    }
  });
}
