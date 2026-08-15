import { FastifyInstance } from 'fastify';
import { db, storage } from '../server';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { normalisePhone, phoneKey, phoneOf, portableProfile, decideLink } from '../lib/identity';

/**
 * Anchor this sign-in to its phone number, adopting an existing profile if the
 * same number has been here before under a different provider's uid.
 *
 * Best-effort: a failure here must never block someone from loading their
 * profile, so everything is caught. Returns the fields that were adopted so the
 * caller can answer with the merged view instead of a stale one.
 */
async function linkByPhone(
  uid: string,
  tokenPhone: string | undefined,
  existing: Record<string, any> | null,
  log: FastifyInstance['log']
): Promise<Record<string, any>> {
  const phone = normalisePhone(tokenPhone) ?? phoneOf(existing);
  if (!phone) return {};

  try {
    const indexRef = db.collection('phone_identities').doc(phoneKey(phone));
    const owner = (await indexRef.get()).data()?.uid ?? null;
    const { claimIndex, adoptFrom } = decideLink(uid, owner);

    if (claimIndex) {
      await indexRef.set({ uid, phone, linked_at: new Date().toISOString() }, { merge: true });
    }

    const updates: Record<string, any> = {};
    if (adoptFrom) {
      const source = (await db.collection('users').doc(adoptFrom).get()).data() ?? null;
      Object.assign(updates, portableProfile(source, existing));
      // Recorded on both docs so support can see why two uids share a profile.
      updates.linked_from_uid = adoptFrom;
    }
    // Store the number on the profile too, so a later token without one (a
    // Google sign-in) can still find its way back to the same identity.
    if (!existing?.phone) updates.phone = phone;

    if (Object.keys(updates).length > 0) {
      updates.identity_linked_at = new Date().toISOString();
      await db.collection('users').doc(uid).set(updates, { merge: true });
    }
    return updates;
  } catch (err) {
    log.error(err, 'Phone identity linking failed');
    return {};
  }
}

const AVATAR_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // signed read URLs last 7 days; refreshed on /me + upload

interface ProfileBody {
  name?: string;
  displayName?: string;
  address?: string;
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
  'name', 'displayName', 'address', 'company', 'employeeId', 'workLocation',
  'role', 'gender', 'corporate_email', 'vehicle_type', 'notifications_enabled',
];

export async function userRoutes(fastify: FastifyInstance) {

  // Return the current user's profile (incl. the server-side onboarded flag).
  fastify.get('/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = request.user!.id;
    try {
      const doc = await db.collection('users').doc(uid).get();
      const stored = doc.exists ? doc.data()! : null;

      // Same person, new sign-in provider: carry their profile across rather
      // than making them do it all again.
      const adopted = await linkByPhone(uid, request.user!.phone, stored, fastify.log);
      const data = { ...(stored ?? {}), ...adopted };

      if (!doc.exists && Object.keys(adopted).length === 0) {
        return reply.send({ id: uid, onboarded: false, profile: null });
      }
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
      return reply.send({
        id: uid,
        onboarded: data.onboarded === true,
        ...data,
        photo_url,
      });
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

}
