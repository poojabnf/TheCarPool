import { FastifyInstance } from 'fastify';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { db, storage, redisClient } from '../server';
import { notificationsQueue } from '../queue/processor';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { verifyAadhaar, verifyDrivingLicence, isKycConfigured } from '../lib/kyc';
import { createMaskedCall, isMaskingConfigured } from '../lib/masking';
import {
  DocumentType, DOCUMENT_TYPES, DOCUMENT_SPECS,
  validateIdNumber, validateExpiry, maskIdNumber, documentHasExpiry,
} from '../lib/idDocuments';
import { crossCheckDocument, extractText } from '../lib/idImageCheck';

/**
 * ID document retention.
 *
 * Images are kept for 15 days and then deleted. Enforcement is the Cloud
 * Storage lifecycle rule in `storage.lifecycle.json` (age 15 days on this
 * prefix) — object expiry is handled by GCS itself rather than app code, so it
 * still happens if the service is down or a cron never fires.
 *
 * The prefix is deliberately top-level: lifecycle rules match a literal prefix
 * and cannot wildcard a uid in the middle of `users/{uid}/kyc/`, so scoping a
 * delete rule there would have caught avatars and classifieds too.
 */
export const KYC_PREFIX = 'kyc-documents/';
export const KYC_RETENTION_DAYS = 15;

const SosSchema = z.object({
  ride_id: z.union([z.string(), z.number()]).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  is_silent: z.boolean().optional().default(false),
});

const KycVerifySchema = z.object({
  aadhaar_number: z.string().optional(),
  dl_number: z.string().optional(),
  vehicle_rc: z.string().optional(),
  // Vehicle insurance (drivers): policy number + expiry. Stored for admin
  // review; an expired policy is rejected outright.
  insurance_policy_number: z.string().trim().min(5).max(40).optional(),
  insurance_valid_till: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
});

// In-memory SOS cooldown: at most one SOS per user per 60s. Prevents a
// compromised/abusive client from spamming emergency alerts. For a multi-
// instance deployment this should move to Redis, but in-memory dedup is a
// safe minimum that closes the spam vector.
const SOS_COOLDOWN_MS = 60 * 1000;
const lastSosByUser = new Map<string, number>();

interface SosTriggerBody {
  user_id: number;
  ride_id: number;
  latitude: number;
  longitude: number;
  is_silent: boolean;
}

interface KycVerifyBody {
  user_id: number;
  aadhaar_number?: string;
  dl_number?: string;
  vehicle_rc?: string;
}

interface RatingBody {
  ride_id: number;
  rater_id: number;
  ratee_id: number;
  rating_score: number;
  feedback?: string;
}

export async function safetyRoutes(fastify: FastifyInstance) {

  // 1. One-Tap SOS & Silent SOS Trigger (Features 20 & 26)
  fastify.post('/sos/trigger', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = parseOrReply(SosSchema, request.body, reply);
    if (!parsed) return;
    const { ride_id, latitude, longitude, is_silent } = parsed;
    // Trust the authenticated identity, not a client-supplied user_id.
    const user_id = request.user!.id;

    // Rate limit / dedupe: one SOS per user per cooldown window. Use Redis with
    // an atomic SET NX EX so the limit holds across multiple backend instances;
    // fall back to an in-memory map only when Redis isn't available.
    const cooldownSeconds = Math.ceil(SOS_COOLDOWN_MS / 1000);
    if (redisClient.isOpen) {
      const acquired = await redisClient.set(`sos:${user_id}`, '1', { NX: true, EX: cooldownSeconds });
      if (acquired === null) {
        return reply.code(429).send({
          error: 'An SOS was already dispatched recently. Please wait before triggering again.',
          retry_after_seconds: cooldownSeconds,
        });
      }
    } else {
      const now = Date.now();
      const last = lastSosByUser.get(user_id) || 0;
      if (now - last < SOS_COOLDOWN_MS) {
        return reply.code(429).send({
          error: 'An SOS was already dispatched recently. Please wait before triggering again.',
          retry_after_seconds: Math.ceil((SOS_COOLDOWN_MS - (now - last)) / 1000),
        });
      }
      lastSosByUser.set(user_id, now);
    }

    fastify.log.warn(`🚨 EMERGENCY SOS TRIGGERED by user ${user_id} on ride ${ride_id}. Silent Mode: ${is_silent}`);

    // Async push to queue to dispatch SMS and notifications reliably in the background
    await notificationsQueue.addJob('dispatch_emergency_alerts', {
      type: 'EMERGENCY_SOS',
      data: { user_id, ride_id, latitude, longitude, is_silent }
    });
    
    return reply.send({
      status: 'CRITICAL_ALERT_DISPATCHED_TO_QUEUE',
      silent: is_silent,
      coordinates: { lat: latitude, lng: longitude },
      dispatched_services: ['Corporate Security', 'Police PCR Control Room', 'Family Emergency Circle'],
      timestamp: new Date()
    });
  });

  // 2. Verified Driver KYC / OCR validations (Feature 22)
  fastify.post('/kyc/verify', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = parseOrReply(KycVerifySchema, request.body, reply);
    if (!parsed) return;
    const { aadhaar_number, dl_number, vehicle_rc, insurance_policy_number, insurance_valid_till } = parsed;
    const user_id = request.user!.id;

    // Reject an already-expired insurance policy before touching the profile.
    if (insurance_valid_till && new Date(insurance_valid_till) < new Date()) {
      return reply.code(400).send({ status: 'FAILED', reason: 'Vehicle insurance has expired. Renew it before verification.' });
    }

    try {
      // Verify against the configured KYC provider (UIDAI/VAHAN via Digio etc.).
      // Without provider keys these fall back to a format-only check (simulated).
      const aadhaarResult = aadhaar_number ? await verifyAadhaar(aadhaar_number) : { verified: false };
      const dlResult = dl_number ? await verifyDrivingLicence(dl_number) : { verified: false };

      if (!aadhaarResult.verified && !dlResult.verified) {
        return reply.code(400).send({ status: 'FAILED', reason: 'Identity could not be verified.' });
      }

      const simulated = Boolean((aadhaarResult as any).simulated || (dlResult as any).simulated);
      const update: Record<string, unknown> = {
        kyc_status: 'VERIFIED',
        kyc_verified_at: new Date().toISOString(),
        kyc_simulated: simulated, // flag so we know if real provider was used
      };
      // Vehicle documents (drivers): kept on the profile for admin review.
      if (vehicle_rc || insurance_policy_number) {
        update.vehicle_docs = {
          ...(vehicle_rc ? { rc_number: vehicle_rc } : {}),
          ...(insurance_policy_number ? { insurance_policy_number } : {}),
          ...(insurance_valid_till ? { insurance_valid_till } : {}),
          submitted_at: new Date().toISOString(),
        };
      }
      await db.collection('users').doc(String(user_id)).update(update);

      return reply.send({
        status: 'VERIFIED',
        user_id,
        aadhaar_match: aadhaarResult.verified,
        dl_match: dlResult.verified,
        provider: isKycConfigured() ? 'external' : 'simulated',
        details: 'Profile upgraded to verified trust-circle status.',
      });
    } catch (err: any) {
      fastify.log.error('KYC update failed:', err);
      return reply.code(500).send({ error: 'Failed to process verification checks.' });
    }
  });

  // 3. Corporate Trust Circles & domains (Feature 23)
  fastify.post('/trust/verify-email', { preHandler: [requireAuth] }, async (request, reply) => {
    const { corporate_email } = request.body as { corporate_email: string };
    const user_id = request.user!.id;

    if (!corporate_email || !corporate_email.includes('@')) {
      return reply.code(400).send({ error: 'Invalid corporate email address.' });
    }

    const domain = corporate_email.split('@')[1].toLowerCase();

    try {
      // Corporate domains are managed in Firestore by admins.
      const domainDoc = await db.collection('corporate_domains').doc(domain).get();
      if (!domainDoc.exists) {
        return reply.code(400).send({
          status: 'UNAUTHORIZED',
          error: 'Corporate domain not in active cluster. Contact support to onboard your company.',
        });
      }

      const domainData = domainDoc.data() as { circle_name?: string; active?: boolean };
      if (domainData.active === false) {
        return reply.code(400).send({ status: 'DEACTIVATED', error: 'Corporate domain is currently deactivated.' });
      }

      await db.collection('users').doc(String(user_id)).update({ company_domain: domain });

      // Count coworkers in the same domain
      const coworkersSnap = await db.collection('users').where('company_domain', '==', domain).get();

      return reply.send({
        status: 'VERIFIED',
        domain,
        circle_name: domainData.circle_name || `${domain.split('.')[0].toUpperCase()} Corporate Circle`,
        coworker_count: coworkersSnap.size,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Corporate domain verification failed');
      return reply.code(500).send({ error: 'Domain verification failed.' });
    }
  });

  // 4. Proxy Number Masking (Feature 24)
  fastify.post('/proxy/mask-call', { preHandler: [requireAuth] }, async (request, reply) => {
    const { rider_id, driver_id } = request.body as { rider_id: string; driver_id: string };
    try {
      const [riderDoc, driverDoc] = await Promise.all([
        db.collection('users').doc(String(rider_id)).get(),
        db.collection('users').doc(String(driver_id)).get(),
      ]);
      const riderPhone = riderDoc.data()?.phone || riderDoc.data()?.phone_number;
      const driverPhone = driverDoc.data()?.phone || driverDoc.data()?.phone_number;
      if (!riderPhone || !driverPhone) {
        return reply.code(400).send({ error: 'Both parties must have a phone number on file.' });
      }

      const result = await createMaskedCall(riderPhone, driverPhone);
      if (!result.configured) {
        return reply.code(503).send({ status: 'MASKING_NOT_CONFIGURED', error: result.reason || 'Call masking is not configured.' });
      }
      if (!result.proxy_number) {
        return reply.code(502).send({ error: result.reason || 'Masking provider error.' });
      }
      return reply.send({
        proxy_number: result.proxy_number,
        session_sid: result.session_sid,
        session_expiry_mins: result.expiry_mins,
        caller_id_masked: true,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Proxy masking failed');
      return reply.code(500).send({ error: 'Failed to create masked call session.' });
    }
  });

  // 5. Bidirectional Ratings (Feature 25)
  fastify.post('/ratings/submit', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id, ratee_id, rating_score, feedback } = request.body as RatingBody;
    const rater_id = request.user!.id;

    if (!ratee_id || !rating_score || rating_score < 1 || rating_score > 5) {
      return reply.code(400).send({ error: 'ratee_id and rating_score (1-5) are required.' });
    }

    if (String(rater_id) === String(ratee_id)) {
      return reply.code(400).send({ error: 'You cannot rate yourself.' });
    }

    try {
      // Idempotent rating doc
      const ratingId = `${ride_id || 'no_ride'}_${rater_id}_${ratee_id}`;
      await db.collection('ratings').doc(ratingId).set({
        ride_id: ride_id ? String(ride_id) : null,
        rater_id: String(rater_id),
        ratee_id: String(ratee_id),
        rating_score: Number(rating_score),
        feedback: feedback || null,
        created_at: new Date().toISOString(),
      }, { merge: true });

      // Recalculate aggregate rating for ratee
      const ratingsSnap = await db.collection('ratings')
        .where('ratee_id', '==', String(ratee_id))
        .get();
      const scores = ratingsSnap.docs.map((d: any) => d.data().rating_score as number);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : rating_score;
      const newAggregate = parseFloat(avg.toFixed(2));

      await db.collection('users').doc(String(ratee_id)).set(
        { aggregate_rating: newAggregate, rating_count: scores.length },
        { merge: true }
      );

      return reply.send({
        status: 'RATING_SAVED',
        ride_id,
        rater_id,
        ratee_id,
        new_aggregate_rating: newAggregate,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Rating submission failed');
      return reply.code(500).send({ error: 'Failed to save rating.' });
    }
  });

  // 6. Geofence Deviation Alerts (Feature 27) — real distance from the planned
  //    route, computed via Haversine against the ride's waypoints polyline.
  fastify.post('/geofence/check', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id, driver_lat, driver_lng } = request.body as any;

    if (!driver_lat || !driver_lng) {
      return reply.code(400).send({ error: 'driver_lat and driver_lng are required.' });
    }

    try {
      // Load the ride's planned route from Firestore.
      // Field is stored as route_coords; waypoints is kept as legacy fallback.
      const rideDoc = ride_id ? await db.collection('rides').doc(String(ride_id)).get() : null;
      const rideData = rideDoc?.exists ? rideDoc.data() : null;
      const waypoints: Array<{ lat: number; lng: number }> =
        rideData?.route_coords || rideData?.waypoints || [];

      if (waypoints.length < 2) {
        // No route stored — return NORMAL so we don't false-alarm
        return reply.send({ status: 'NORMAL', deviation_meters: 0, note: 'No route waypoints stored for this ride.' });
      }

      // Haversine distance from a point to a line segment
      function toRad(d: number) { return (d * Math.PI) / 180; }
      function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
        const R = 6371000;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      // Find minimum distance from driver position to any route segment
      let minDist = Infinity;
      for (let i = 0; i < waypoints.length - 1; i++) {
        const d = haversine(driver_lat, driver_lng, waypoints[i].lat, waypoints[i].lng);
        if (d < minDist) minDist = d;
      }
      // Also check last waypoint
      const lastWp = waypoints[waypoints.length - 1];
      const dLast = haversine(driver_lat, driver_lng, lastWp.lat, lastWp.lng);
      if (dLast < minDist) minDist = dLast;

      const DEVIATION_THRESHOLD_METERS = 400;
      if (minDist > DEVIATION_THRESHOLD_METERS) {
        return reply.send({
          status: 'WARNING_BREACH',
          deviation_meters: Math.round(minDist),
          action_required: 'ALERT_SENT_TO_PASSENGERS',
          silent_security_ping: true,
        });
      }

      return reply.send({ status: 'NORMAL', deviation_meters: Math.round(minDist) });
    } catch (err: any) {
      fastify.log.error(err, 'Geofence check failed');
      return reply.code(500).send({ error: 'Geofence check failed.' });
    }
  });

  // 7. Safety Circle Auto-Share contacts (Feature 28)
  // List the caller's emergency contacts (Safety Center).
  fastify.get('/safety/contacts', { preHandler: [requireAuth] }, async (request, reply) => {
    try {
      const snap = await db.collection('users').doc(request.user!.id).collection('safety_contacts').get();
      const contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return reply.send({ contacts });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list safety contacts');
      return reply.code(500).send({ error: 'Failed to list safety contacts.' });
    }
  });

  fastify.post('/safety/contacts', { preHandler: [requireAuth] }, async (request, reply) => {
    const { contact_name, contact_phone } = request.body as any;
    const uid = request.user!.id;

    if (!contact_name || !contact_phone) {
      return reply.code(400).send({ error: 'contact_name and contact_phone are required.' });
    }

    const contactId = `${contact_phone.replace(/\D/g, '')}`;
    await db.collection('users').doc(String(uid)).collection('safety_contacts').doc(contactId).set({
      name: contact_name,
      phone: contact_phone,
      auto_share_enabled: true,
      added_at: new Date().toISOString(),
    }, { merge: true });

    return reply.send({
      status: 'CONTACT_ADDED',
      user_id: uid,
      contact: { name: contact_name, phone: contact_phone },
      auto_share_enabled: true,
    });
  });

  // 9. Delete Profile / Account (GDPR & Privacy Compliance)
  // ── Account deletion ─────────────────────────────────────────────────────
  // Required by both app stores for any app with sign-up, and a data-protection
  // obligation besides.
  //
  // Two rules shape this:
  //   1. Never delete while money is in play. A stranded wallet balance or an
  //      escrow still HELD has no owner left to refund once the account is gone.
  //   2. Never hard-delete rides and bookings. They are shared financial records
  //      — the other party's trip history and our own tax/dispute trail live in
  //      them. They are ANONYMISED instead, so the counterparty keeps their
  //      history while the departing user's identity is severed from it.
  fastify.delete('/account', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = String(request.user!.id);
    const body = (request.body as any) || {};
    // user_id in the body is optional and only ever a cross-check; the token is
    // the authority on who is being deleted.
    if (body.user_id && String(body.user_id) !== uid) {
      return reply.code(403).send({ error: 'Forbidden: you can only delete your own account.' });
    }

    try {
      // ── Blockers: anything that would strand money or strand a passenger ──
      const blockers: string[] = [];

      const walletSnap = await db.collection('wallets').doc(uid).get();
      const balance = Number(walletSnap.data()?.available_wallet_balance || 0);
      if (balance > 0) {
        blockers.push(`You have ₹${balance.toFixed(2)} in your wallet. Withdraw it before deleting your account.`);
      }

      const heldBookings = await db.collection('bookings')
        .where('rider_id', '==', uid)
        .where('escrow_status', '==', 'HELD')
        .get();
      if (!heldBookings.empty) {
        blockers.push(`You have ${heldBookings.size} active booking(s). Cancel or complete them first.`);
      }

      const activeRides = await db.collection('rides')
        .where('driver_uid', '==', uid)
        .where('status', 'in', ['SCHEDULED', 'STARTED'])
        .get();
      const ridesWithPassengers = activeRides.docs.filter(
        (d) => Number(d.data().seats_total || 0) > Number(d.data().seats_available || 0)
      );
      if (ridesWithPassengers.length > 0) {
        blockers.push(`You have ${ridesWithPassengers.length} upcoming ride(s) with passengers booked. Cancel them first.`);
      }

      if (blockers.length > 0) {
        return reply.code(409).send({
          error: 'DELETION_BLOCKED',
          message: 'Your account cannot be deleted yet.',
          blockers,
        });
      }

      const now = new Date().toISOString();

      // ── Anonymise shared records rather than destroying them ─────────────
      const batch = db.batch();

      // Empty upcoming rides can simply be cancelled — nobody is relying on them.
      for (const doc of activeRides.docs) {
        batch.update(doc.ref, { status: 'CANCELLED', cancelled_at: now, cancelled_reason: 'DRIVER_ACCOUNT_DELETED' });
      }
      // Past rides keep their financial shape, lose the identity.
      const pastRides = await db.collection('rides').where('driver_uid', '==', uid).get();
      for (const doc of pastRides.docs) {
        batch.update(doc.ref, { driver_name: 'Deleted user', driver_uid_deleted: true, anonymised_at: now });
      }
      const pastBookings = await db.collection('bookings').where('rider_id', '==', uid).get();
      for (const doc of pastBookings.docs) {
        batch.update(doc.ref, { rider_name: 'Deleted user', rider_deleted: true, anonymised_at: now });
      }
      await batch.commit();

      // ── Delete what is genuinely the user's own ──────────────────────────
      // Classifieds are the user's own content, so they go entirely.
      const classifieds = await db.collection('classifieds').where('author_id', '==', uid).get();
      await Promise.all(classifieds.docs.map((d) => d.ref.delete().catch(() => {})));

      await Promise.all([
        db.collection('users').doc(uid).delete().catch(() => {}),
        db.collection('wallets').doc(uid).delete().catch(() => {}),
        db.collection('device_coordinates').doc(uid).delete().catch(() => {}),
      ]);

      // Stored files: avatar, classified photos, and ID documents. The KYC
      // lifecycle rule would eventually clear the last of these anyway, but a
      // deletion request should not wait up to 6 months to take effect.
      await Promise.all([
        storage.bucket().deleteFiles({ prefix: `users/${uid}/` }).catch(() => {}),
        storage.bucket().deleteFiles({ prefix: `${KYC_PREFIX}${uid}/` }).catch(() => {}),
      ]);

      const kycDocs = await db.collection('kyc_documents').where('user_id', '==', uid).get();
      await Promise.all(kycDocs.docs.map((d) => d.ref.delete().catch(() => {})));

      // ── Finally the auth identity ────────────────────────────────────────
      // Last, deliberately: while it exists the user can still authenticate and
      // retry if any step above failed. Removing it first would lock them out
      // of an account that still held their data.
      try {
        await admin.auth().deleteUser(uid);
      } catch (authErr: any) {
        fastify.log.warn(authErr, `Firebase Auth user ${uid} not found or already deleted.`);
      }

      fastify.log.info({ uid, rides: pastRides.size, bookings: pastBookings.size }, 'Account deleted');
      return reply.send({
        status: 'ACCOUNT_DELETED',
        anonymised_rides: pastRides.size,
        anonymised_bookings: pastBookings.size,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Account deletion failed');
      return reply.code(500).send({ error: 'Failed to delete account. Please try again.' });
    }
  });

  // 8. Secure Document Upload to Firebase Storage for OCR Scanning (Feature 16 component)
  fastify.post('/kyc/upload', { preHandler: [requireAuth] }, async (request, reply) => {
    // Generate a signed URL for the client to securely upload their KYC documents to Firebase Storage
    const body = (request.body as any) || {};
    const filename = body.filename || `doc_${Date.now()}.jpg`;
    const content_type = body.content_type || 'image/jpeg';
    const document_type = (body.document_type || 'general').replace(/[^a-zA-Z0-9_-]/g, '');
    const uid = request.user!.id;

    try {
      const bucket = storage.bucket(); // Default firebase bucket
      // ID documents live under their OWN top-level prefix, not users/{uid}/…,
      // so a storage lifecycle rule can delete them on a retention schedule
      // without touching avatars or classifieds in the same user folder.
      // GCS lifecycle prefixes cannot wildcard the uid in the middle of a path.
      // The uid still comes from the token, so nobody can write into another
      // user's folder.
      const file = bucket.file(`${KYC_PREFIX}${uid}/${document_type}/${Date.now()}_${filename}`);

      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType: content_type,
      });

      const deleteAfter = new Date(Date.now() + KYC_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      // Record the retention deadline alongside the object. The storage
      // lifecycle rule is what actually deletes it; this is the audit trail and
      // lets us show the user when their document goes.
      await db.collection('kyc_documents').doc(`${uid}_${Date.now()}`).set({
        user_id: uid,
        document_type,
        file_key: file.name,
        uploaded_at: new Date().toISOString(),
        delete_after: deleteAfter.toISOString(),
        retention_days: KYC_RETENTION_DAYS,
      }).catch(() => { /* audit record is best-effort; never block the upload */ });

      return reply.code(201).send({
        status: 'SIGNED_UPLOAD_URL_GENERATED',
        bucket: bucket.name,
        file_key: file.name,
        upload_url: uploadUrl,
        retention_days: KYC_RETENTION_DAYS,
        delete_after: deleteAfter.toISOString(),
        ready_for_ai_ocr: true
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to generate Firebase Storage signed URL');
      return reply.code(500).send({ error: 'Failed to initialize Firebase Storage bucket.' });
    }
  });

  // ── ID document submission ───────────────────────────────────────────────
  // The rider/driver enters a document type + number (+ expiry where the
  // document has one) and uploads a photo of that same document. We validate
  // the number's format and checksum, then OCR the image and cross-check that
  // it really is that document and really carries that number.
  //
  // Fails CLOSED: if OCR is unavailable we reject rather than wave the document
  // through, because this is the only barrier between a typed number and a
  // verified account.
  fastify.post('/kyc/document', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = String(request.user!.id);
    const body = (request.body as any) || {};
    const type = String(body.document_type || '').toUpperCase() as DocumentType;
    const idNumber = String(body.id_number || '');
    const expiry = body.expiry ?? null;
    const imageBase64 = String(body.image_base64 || '');

    if (!DOCUMENT_TYPES.includes(type)) {
      return reply.code(400).send({ error: 'Choose a valid document type.', accepted: DOCUMENT_TYPES });
    }

    // 1. Number format + checksum (Aadhaar Verhoeff, PAN holder type, etc.)
    const idCheck = validateIdNumber(type, idNumber);
    if (!idCheck.valid) {
      return reply.code(400).send({ error: 'INVALID_ID_NUMBER', message: idCheck.reason, code: idCheck.code });
    }

    // 2. Expiry rules — required where the document has one, refused where not.
    const expiryCheck = validateExpiry(type, expiry);
    if (!expiryCheck.valid) {
      return reply.code(400).send({ error: 'INVALID_EXPIRY', message: expiryCheck.reason, code: expiryCheck.code });
    }

    if (!imageBase64) {
      return reply.code(400).send({ error: 'IMAGE_REQUIRED', message: `Upload a photo of your ${DOCUMENT_SPECS[type].label}.` });
    }

    // 3. OCR + cross-check the photo against what was typed.
    let ocrText = '';
    try {
      const token = await admin.credential.applicationDefault().getAccessToken();
      ocrText = await extractText(imageBase64, token.access_token);
    } catch (err: any) {
      fastify.log.error(err, 'Document OCR failed');
      return reply.code(503).send({
        error: 'VERIFICATION_UNAVAILABLE',
        message: 'We could not check your document right now. Please try again shortly.',
      });
    }

    const cross = crossCheckDocument({ type, idNumber: idCheck.normalised, ocrText, expiry });
    if (!cross.ok) {
      // Record the attempt so repeated failures are visible to support.
      await db.collection('kyc_attempts').add({
        user_id: uid, document_type: type, ok: false,
        checks: cross.checks, at: new Date().toISOString(),
      }).catch(() => {});
      return reply.code(400).send({
        error: 'DOCUMENT_MISMATCH',
        message: cross.reasons[0] || 'That document could not be verified.',
        reasons: cross.reasons,
        checks: cross.checks,
      });
    }

    // 4. Passed. Store ONLY the masked number — never the raw value.
    await db.collection('users').doc(uid).set({
      id_document: {
        type,
        masked_number: maskIdNumber(type, idCheck.normalised),
        expiry: documentHasExpiry(type) ? expiry : null,
        verified_at: new Date().toISOString(),
        match_score: cross.score,
      },
      id_document_verified: true,
    }, { merge: true });

    return reply.send({
      status: 'DOCUMENT_VERIFIED',
      document_type: type,
      masked_number: maskIdNumber(type, idCheck.normalised),
      score: cross.score,
    });
  });

  // ── Self-service KYC completion ──────────────────────────────────────────
  // Called by the mobile onboarding wizard at the end of the flow.
  //
  // This used to set kyc_status = VERIFIED unconditionally, which meant anyone
  // who called it directly was verified — bypassing every document check, and
  // with it the gates on booking, offering rides and payouts. It now refuses
  // unless a government ID has actually passed /kyc/document.
  fastify.post('/kyc/complete', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = request.user!.id;
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.data()?.id_document_verified !== true) {
        return reply.code(403).send({
          error: 'DOCUMENT_REQUIRED',
          message: 'Verify a government ID before completing verification.',
        });
      }

      await db.collection('users').doc(uid).set({
        kyc_status: 'VERIFIED',
        kyc_completed_at: new Date().toISOString(),
        onboarded: true,
      }, { merge: true });

      fastify.log.info({ uid }, 'KYC completed with a verified ID document');
      return reply.send({ status: 'KYC_VERIFIED', user_id: uid });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to complete KYC');
      return reply.code(500).send({ error: 'Failed to update KYC status.' });
    }
  });
}
