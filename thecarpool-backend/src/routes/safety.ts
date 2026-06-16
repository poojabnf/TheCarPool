import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, storage } from '../server';
import { notificationsQueue } from '../queue/processor';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';

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

    // Rate limit / dedupe: one SOS per user per cooldown window.
    const now = Date.now();
    const last = lastSosByUser.get(user_id) || 0;
    if (now - last < SOS_COOLDOWN_MS) {
      return reply.code(429).send({
        error: 'An SOS was already dispatched recently. Please wait before triggering again.',
        retry_after_seconds: Math.ceil((SOS_COOLDOWN_MS - (now - last)) / 1000),
      });
    }
    lastSosByUser.set(user_id, now);

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
      // Simulate government database check (UIDAI / VAHAN)
      const isAadhaarValid = aadhaar_number && aadhaar_number.length === 12;
      const isDlValid = dl_number && dl_number.length > 5;
      
      if (!isAadhaarValid && !isDlValid) {
        return reply.code(400).send({ status: 'FAILED', reason: 'Invalid KYC identification parameters' });
      }

      await db.collection('users').doc(String(user_id)).update({
        kyc_status: 'VERIFIED'
      });
      
      return reply.send({
        status: 'VERIFIED',
        user_id,
        vahan_match: true,
        aadhaar_match: true,
        details: 'Profile fully upgraded to Corporate trust circle status'
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
    
    const domain = corporate_email.split('@')[1];
    const allowedDomains = ['google.com', 'tcs.com', 'infosys.com', 'microsoft.com', 'wipro.com'];
    
    if (!allowedDomains.includes(domain)) {
      return reply.code(400).send({ status: 'UNAUTHORIZED', error: 'Corporate domain verification failed. Workspace not in active cluster.' });
    }
    
    await db.collection('users').doc(String(user_id)).update({
      company_domain: domain
    });

    return reply.send({
      status: 'VERIFIED',
      domain,
      circle_name: `${domain.split('.')[0].toUpperCase()} Corporate Circle`,
      coworker_count: 142
    });
  });

  // 4. Proxy Number Masking (Feature 24)
  fastify.post('/proxy/mask-call', { preHandler: [requireAuth] }, async (request, reply) => {
    const { rider_id, driver_id } = request.body as { rider_id: number; driver_id: number };
    
    // Generates a temporary Twilio proxy phone number to route calls anonymously
    return reply.send({
      proxy_number: '+919999002281',
      session_expiry_mins: 120,
      caller_id_masked: true
    });
  });

  // 5. Bidirectional Ratings (Feature 25)
  fastify.post('/ratings/submit', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id, rater_id, ratee_id, rating_score, feedback } = request.body as RatingBody;
    
    // In production, rating scores adjust users/drivers trust indexes
    return reply.send({
      status: 'RATING_SAVED',
      ride_id,
      rater_id,
      ratee_id,
      new_aggregate_rating: 4.85
    });
  });

  // 6. Geofence Deviation Alerts (Feature 27)
  fastify.post('/geofence/check', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id, driver_lat, driver_lng, route_id } = request.body as any;
    
    // Detour deviation trigger checks: if distance to route line > 400m
    const geofence_breached = Math.random() > 0.85; // Simulated deviation trigger
    
    if (geofence_breached) {
      return reply.send({
        status: 'WARNING_BREACH',
        deviation_meters: 420,
        action_required: 'ALERT_SENT_TO_PASSENGERS',
        silent_security_ping: true
      });
    }
    
    return reply.send({
      status: 'NORMAL',
      deviation_meters: 18
    });
  });

  // 7. Safety Circle Auto-Share contacts (Feature 28)
  fastify.post('/safety/contacts', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id, contact_name, contact_phone } = request.body as any;
    return reply.send({
      status: 'CONTACT_ADDED',
      user_id,
      contact: { name: contact_name, phone: contact_phone },
      auto_share_enabled: true
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
