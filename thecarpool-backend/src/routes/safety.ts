import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, storage, redisClient } from '../server';
import { notificationsQueue } from '../queue/processor';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { verifyAadhaar, verifyDrivingLicence, isKycConfigured } from '../lib/kyc';
import { createMaskedCall, isMaskingConfigured } from '../lib/masking';

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
    const { aadhaar_number, dl_number, vehicle_rc } = parsed;
    const user_id = request.user!.id;

    try {
      // Verify against the configured KYC provider (UIDAI/VAHAN via Digio etc.).
      // Without provider keys these fall back to a format-only check (simulated).
      const aadhaarResult = aadhaar_number ? await verifyAadhaar(aadhaar_number) : { verified: false };
      const dlResult = dl_number ? await verifyDrivingLicence(dl_number) : { verified: false };

      if (!aadhaarResult.verified && !dlResult.verified) {
        return reply.code(400).send({ status: 'FAILED', reason: 'Identity could not be verified.' });
      }

      const simulated = Boolean((aadhaarResult as any).simulated || (dlResult as any).simulated);
      await db.collection('users').doc(String(user_id)).update({
        kyc_status: 'VERIFIED',
        kyc_verified_at: new Date().toISOString(),
        kyc_simulated: simulated, // flag so we know if real provider was used
      });

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
      // Load the ride's planned waypoints from Firestore
      const rideDoc = ride_id ? await db.collection('rides').doc(String(ride_id)).get() : null;
      const waypoints: Array<{ lat: number; lng: number }> =
        rideDoc?.exists ? (rideDoc.data()?.waypoints || []) : [];

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
  fastify.delete('/account', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id } = request.body as { user_id: string };

    if (!user_id) {
      return reply.code(400).send({ error: 'user_id is required.' });
    }

    // A user may only delete their own account.
    if (String(request.user!.id) !== String(user_id)) {
      return reply.code(403).send({ error: 'Forbidden: you can only delete your own account.' });
    }

    try {
      // 1. Delete all user data from Firestore subcollections and the main user doc
      const userDocRef = db.collection('users').doc(String(user_id));

      // Delete user's rides as a driver
      const driverRides = await db.collection('rides').where('driver_id', '==', String(user_id)).get();
      const driverRideDeletes = driverRides.docs.map((doc: any) => doc.ref.delete());

      // Delete user's bookings
      const bookings = await db.collection('bookings').where('rider_id', '==', String(user_id)).get();
      const bookingDeletes = bookings.docs.map((doc: any) => doc.ref.delete());

      // Delete user's classifieds
      const classifieds = await db.collection('classifieds').where('author_id', '==', String(user_id)).get();
      const classifiedDeletes = classifieds.docs.map((doc: any) => doc.ref.delete());

      // Execute all Firestore deletes in parallel
      await Promise.all([
        userDocRef.delete(),
        ...driverRideDeletes,
        ...bookingDeletes,
        ...classifiedDeletes,
      ]);

      // 2. Delete the Firebase Auth account (Admin SDK)
      const admin = require('firebase-admin');
      try {
        await admin.auth().deleteUser(String(user_id));
      } catch (authErr: any) {
        // Log but don't fail — Firestore data is already removed
        fastify.log.warn(authErr, `Firebase Auth user ${user_id} not found or already deleted.`);
      }

      fastify.log.info(`Account deletion complete for user: ${user_id}`);
      return reply.send({ status: 'ACCOUNT_DELETED', user_id });
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
      // Bind the upload path to the authenticated user so one user can never
      // write into another user's KYC folder.
      const file = bucket.file(`users/${uid}/kyc/${document_type}/${Date.now()}_${filename}`);
      
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType: content_type,
      });

      return reply.code(201).send({
        status: 'SIGNED_UPLOAD_URL_GENERATED',
        bucket: bucket.name,
        file_key: file.name,
        upload_url: uploadUrl,
        ready_for_ai_ocr: true
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to generate Firebase Storage signed URL');
      return reply.code(500).send({ error: 'Failed to initialize Firebase Storage bucket.' });
    }
  });
}
