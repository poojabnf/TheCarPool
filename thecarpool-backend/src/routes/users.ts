import { FastifyInstance } from 'fastify';
import { db, storage } from '../server';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { checkLicence, maskLicence } from '../lib/licence';
import { verifyDrivingLicence, isDlVerificationConfigured } from '../lib/dlVerify';
import {
  normalisePhone, phoneKey, phoneOf, portableProfile, decideLink,
  normaliseEmail, emailKey, emailOf,
} from '../lib/identity';

/**
 * Anchor this sign-in to its email, adopting an existing profile if the same
 * address has been here before under a different provider's uid.
 *
 * The phone index alone left a real gap: someone who signed up with Google
 * (no phone on the token) and later used phone OTP got two profiles, because
 * neither sign-in ever presented a number the other had claimed. Email is the
 * second anchor, and works the same way.
 *
 * Best-effort, exactly like the phone linker: a failure here must never stop
 * someone loading their profile.
 */
async function linkByEmail(
  uid: string,
  tokenEmail: string | undefined,
  emailVerified: boolean,
  existing: Record<string, any> | null,
  log: FastifyInstance['log']
): Promise<Record<string, any>> {
  const email = normaliseEmail(tokenEmail) ?? emailOf(existing);
  if (!email) return {};

  // An unverified address is a claim, not an identity.
  //
  // Linking adopts a profile from whoever already holds this address --
  // their name, their corporate_email, and payout_method, the instruction
  // for where earnings are sent. Firebase will happily issue a token for an
  // email/password account whose address was never confirmed, so signing up
  // as someone else's address was enough to inherit their profile and take
  // over the index entry, leaving their later sign-ins pointing at the
  // attacker's uid. Nothing in the codebase checked email_verified.
  //
  // Only a provider-verified address links. An unverified one is left alone:
  // the account still works, it simply does not inherit anyone else's.
  if (tokenEmail && !emailVerified) {
    log.warn(
      { uid, email },
      'Identity linking skipped: the token email is not verified'
    );
    return {};
  }

  try {
    const indexRef = db.collection('email_identities').doc(emailKey(email));
    const owner = (await indexRef.get()).data()?.uid ?? null;
    const { claimIndex, adoptFrom } = decideLink(uid, owner);

    if (claimIndex) {
      await indexRef.set({ uid, email, linked_at: new Date().toISOString() }, { merge: true });
    }

    const updates: Record<string, any> = {};
    if (adoptFrom) {
      const source = (await db.collection('users').doc(adoptFrom).get()).data() ?? null;
      Object.assign(updates, portableProfile(source, existing));
      updates.linked_from_uid = adoptFrom;
    }
    // Keep the address on the profile so a later token without one (a phone
    // OTP sign-in) can still find its way back to the same identity.
    if (!existing?.email) updates.email = email;

    if (Object.keys(updates).length > 0) {
      updates.identity_linked_at = new Date().toISOString();
      await db.collection('users').doc(uid).set(updates, { merge: true });
    }
    return updates;
  } catch (err) {
    log.error(err, 'Email identity linking failed');
    return {};
  }
}

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
      // than making them do it all again. Phone first — it is the stronger
      // anchor, being verified by OTP — then email for the Google/Apple case
      // where no number is ever presented. The email pass sees what the phone
      // pass adopted, so it fills only what is still missing.
      const byPhone = await linkByPhone(uid, request.user!.phone, stored, fastify.log);
      const afterPhone = { ...(stored ?? {}), ...byPhone };
      const byEmail = await linkByEmail(uid, request.user!.email, request.user!.emailVerified === true, afterPhone, fastify.log);
      const adopted = { ...byPhone, ...byEmail };
      const data = { ...(stored ?? {}), ...adopted };

      const resolvedName = data.name || data.displayName || null;
      if (resolvedName) {
        data.name = resolvedName;
        data.displayName = resolvedName;
      }

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
      // Spread, then take the tax number back out.
      //
      // `...data` returns the whole user document, and a PAN lives on it. This
      // is the caller's own record, so it is not exposure to a stranger -- but
      // a raw tax identifier should not ride along in every profile fetch,
      // through the client's memory, its logs and any cache in between, when
      // no screen displays it. payout-method already returns a masked form for
      // the one place that shows it at all.
      const { pan_number, dl_number, ...safe } = data as Record<string, unknown>;
      return reply.send({
        id: uid,
        onboarded: data.onboarded === true,
        ...safe,
        pan_on_file: typeof pan_number === 'string' && pan_number.length > 0,
        dl_number_masked: maskLicence(dl_number as string | null),
        dl_verified: false,
        name: resolvedName,
        displayName: resolvedName,
        photo_url,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to load user profile');
      return reply.code(500).send({ error: 'Failed to load profile.' });
    }
  });

  // Upload / replace the user's profile photo (base64 JPEG/PNG from the app's
  // camera or gallery). Stored in Storage; a fresh signed read URL is returned.
  /**
   * ── POST /licence ────────────────────────────────────────────────────────
   * Record the caller's driving licence.
   *
   * Declared, not verified -- see lib/licence. The number is stored so a KYC
   * provider can later check it and stamp verified_at; until then nothing in
   * the app may present this driver as verified.
   */
  fastify.post('/licence', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = String(request.user!.id);
    const { dl_number, dl_expiry, dob } = (request.body as {
      dl_number?: string; dl_expiry?: string; dob?: string;
    }) || {};

    const check = checkLicence(dl_number, dl_expiry);
    if (!check.ok) {
      return reply.code(400).send({ error: 'INVALID_LICENCE', message: check.reason });
    }

    await db.collection('users').doc(uid).set({
      dl_number: check.normalised,
      dl_expiry: new Date(String(dl_expiry)).toISOString(),
      dl_submitted_at: new Date().toISOString(),
      // Explicitly null. A field that is absent invites a later reader to
      // assume it was simply not fetched; null says nobody has checked.
      dl_verified_at: null,
    }, { merge: true });

    // Independent check against the transport record, when a provider is
    // configured and the driver gave their date of birth (the provider needs it).
    if (isDlVerificationConfigured() && dob && !Number.isNaN(Date.parse(String(dob)))) {
      const v = await verifyDrivingLicence(String(check.normalised), new Date(String(dob)).toISOString());
      if (v.status === 'VERIFIED') {
        await db.collection('users').doc(uid).set({
          dl_verified_at: new Date().toISOString(),
          dl_verified_name: v.holder_name || null,
          dl_verification_provider: 'surepass',
        }, { merge: true });
        return reply.send({
          dl_number_masked: maskLicence(check.normalised),
          dl_expiry,
          verified: true,
          note: 'Licence verified against the transport department record.',
        });
      }
      if (v.status === 'NOT_FOUND') {
        return reply.code(400).send({
          error: 'LICENCE_NOT_FOUND',
          message: 'We could not find this licence with that date of birth. Please check both and try again.',
        });
      }
    }

    return reply.send({
      dl_number_masked: maskLicence(check.normalised),
      dl_expiry,
      verified: false,
      note: 'Recorded. Licence details are not yet independently verified.',
    });
  });

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

    // Keep name and displayName synchronized
    if (updates.name && !updates.displayName) updates.displayName = updates.name;
    if (updates.displayName && !updates.name) updates.name = updates.displayName;

    if (request.user?.phone && !updates.phone) updates.phone = request.user.phone;
    if (request.user?.email && !updates.email) updates.email = request.user.email;

    updates.onboarded = true;
    updates.updated_at = new Date().toISOString();

    try {
      await db.collection('users').doc(uid).set(updates, { merge: true });

      // Only index identities proven by Firebase Auth claims (not untrusted form inputs)
      const phone = normalisePhone(request.user?.phone);
      if (phone) {
        await db.collection('phone_identities').doc(phoneKey(phone)).set({
          uid, phone, linked_at: new Date().toISOString(),
        }, { merge: true }).catch(() => {});
      }

      const email = normaliseEmail(request.user?.email);
      if (email) {
        await db.collection('email_identities').doc(emailKey(email)).set({
          uid, email, linked_at: new Date().toISOString(),
        }, { merge: true }).catch(() => {});
      }

      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.data();

      return reply.send({ status: 'PROFILE_SAVED', user_id: uid, onboarded: true, profile: { ...userData, ...updates } });
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
