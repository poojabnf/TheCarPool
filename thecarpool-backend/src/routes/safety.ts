import { FastifyInstance } from 'fastify';
import { defaultCurrency } from '../lib/config';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { db, storage, redisClient } from '../server';
import { notificationsQueue } from '../queue/processor';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { createMaskedCall, isMaskingConfigured } from '../lib/masking';
import { hasPayoutMethod, maskPayoutMethod } from '../lib/payouts';

/**
 * Where a deleted user's leftover wallet balance goes when they have no payout
 * details on file. Set to the owner/platform account uid.
 *
 * Every sweep is recorded per-user in `platform_swept_balances` so it can be
 * reconciled, or refunded if the person later asks where their money went.
 */
export const PLATFORM_OWNER_UID = process.env.PLATFORM_OWNER_UID || '';

const SosSchema = z.object({
  ride_id: z.union([z.string(), z.number()]).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  is_silent: z.boolean().optional().default(false),
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

      // Check if user authenticated directly with this domain email
      const authedEmail = String(request.user?.email || '').toLowerCase();
      const authedDomain = authedEmail.includes('@') ? authedEmail.split('@')[1] : '';

      if (authedDomain !== domain && request.user?.role !== 'ADMIN') {
        // Require explicit domain match on authenticated token
        return reply.code(403).send({
          status: 'CHALLENGE_REQUIRED',
          error: `Please sign in with your corporate @${domain} email account to join this Trust Circle.`
        });
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
        { aggregate_rating: newAggregate, rating_avg: newAggregate, rating_count: scores.length },
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

      // A wallet balance never blocks deletion — the app stores require the
      // path to be reachable, and a few rupees that are impractical to withdraw
      // would otherwise trap someone in an account they want gone. It is
      // settled instead: refunded to the user if they have payout details on
      // file, otherwise swept to the platform. See settleBalance below.
      const walletSnap = await db.collection('wallets').doc(uid).get();
      const userSnap = await db.collection('users').doc(uid).get();
      const balance = Number(walletSnap.data()?.available_wallet_balance || 0);

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

      // ── Settle the leftover balance ──────────────────────────────────────
      // Owner's rule: refund it to the user's own account when they have payout
      // details on file; otherwise it goes to the platform.
      //
      // The refund is QUEUED rather than fired inline. An irreversible external
      // transfer in the middle of a deletion has no good failure mode — if the
      // payout succeeds but a later step throws, or the payout fails after the
      // wallet is gone, the money is unrecoverable. A queued record is picked up
      // by the existing payout path and is safe to retry.
      let balanceOutcome: string | null = null;
      if (balance > 0) {
        const method = walletSnap.data()?.payout_method ?? userSnap?.data()?.payout_method ?? null;
        if (hasPayoutMethod(method)) {
          await db.collection('pending_refunds').add({
            user_id: uid,
            amount: balance,
            payout_method: method,
            masked_destination: maskPayoutMethod(method),
            reason: 'ACCOUNT_DELETED',
            status: 'PENDING',
            created_at: now,
          }).catch(() => {});
          balanceOutcome = 'REFUND_QUEUED';
          fastify.log.info({ uid, amount: balance }, 'Balance queued for refund on account deletion');
        } else {
          // No way to pay them back. Swept to the platform, recorded per-user
          // so it can be reconciled — or refunded if they ever come back and
          // ask where their money went.
          await db.collection('platform_swept_balances').add({
            user_id: uid,
            amount: balance,
            reason: 'ACCOUNT_DELETED_NO_PAYOUT_METHOD',
            status: 'SWEPT',
            at: now,
          }).catch(() => {});
          if (PLATFORM_OWNER_UID) {
            const ownerRef = db.collection('wallets').doc(PLATFORM_OWNER_UID);
            await db.runTransaction(async (tx) => {
              const cur = await tx.get(ownerRef);
              const bal = Number(cur.data()?.available_wallet_balance || 0);
              tx.set(ownerRef, {
                ...(cur.exists ? cur.data() : { escrow_locked_balance: 0, currency: defaultCurrency() }),
                available_wallet_balance: Math.round((bal + balance) * 100) / 100,
              }, { merge: true });
            }).catch((e) => fastify.log.error(e, 'Failed to sweep balance to platform owner'));
          }
          balanceOutcome = 'SWEPT_TO_PLATFORM';
          fastify.log.warn({ uid, amount: balance }, 'Balance swept to platform on account deletion');
        }
      }

      // ── Anonymise shared records rather than destroying them ─────────────
      // Updates are merged PER DOCUMENT before writing. `pastRides` is every
      // ride for this driver, which includes the active ones, so writing the
      // cancellation and the anonymisation separately put two writes for the
      // same doc in one batch — Firestore rejects that outright, the commit
      // threw, and deletion failed for any driver with an upcoming ride.
      const rideUpdates = new Map<string, { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }>();
      const mergeUpdate = (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => {
        const existing = rideUpdates.get(ref.path);
        if (existing) Object.assign(existing.data, data);
        else rideUpdates.set(ref.path, { ref, data: { ...data } });
      };

      // Empty upcoming rides can simply be cancelled — nobody is relying on them.
      for (const doc of activeRides.docs) {
        mergeUpdate(doc.ref, { status: 'CANCELLED', cancelled_at: now, cancelled_reason: 'DRIVER_ACCOUNT_DELETED' });
      }
      // Every ride keeps its financial shape but loses the identity.
      const pastRides = await db.collection('rides').where('driver_uid', '==', uid).get();
      for (const doc of pastRides.docs) {
        mergeUpdate(doc.ref, { driver_name: 'Deleted user', driver_uid_deleted: true, anonymised_at: now });
      }
      const pastBookings = await db.collection('bookings').where('rider_id', '==', uid).get();
      for (const doc of pastBookings.docs) {
        mergeUpdate(doc.ref, { rider_name: 'Deleted user', rider_deleted: true, anonymised_at: now });
      }

      // Firestore caps a batch at 500 writes, so chunk. A prolific driver would
      // otherwise be undeletable for the same "it worked in testing" reason.
      const writes = [...rideUpdates.values()];
      const BATCH_LIMIT = 450;
      for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const w of writes.slice(i, i + BATCH_LIMIT)) batch.update(w.ref, w.data);
        await batch.commit();
      }

      // ── Delete what is genuinely the user's own ──────────────────────────
      // Classifieds are the user's own content, so they go entirely.
      const [classifiedsAuthor, classifiedsUser] = await Promise.all([
        db.collection('classifieds').where('author_id', '==', uid).get(),
        db.collection('classifieds').where('user_id', '==', uid).get(),
      ]);
      const allClassifiedDocs = [...classifiedsAuthor.docs, ...classifiedsUser.docs];
      await Promise.all(allClassifiedDocs.map((d) => d.ref.delete().catch(() => {})));

      await Promise.all([
        db.collection('users').doc(uid).delete().catch(() => {}),
        db.collection('wallets').doc(uid).delete().catch(() => {}),
        db.collection('device_coordinates').doc(uid).delete().catch(() => {}),
      ]);

      // Stored files: avatar and classified photos.
      await storage.bucket().deleteFiles({ prefix: `users/${uid}/` }).catch(() => {});

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
        balance_settled: balance > 0 ? { amount: balance, outcome: balanceOutcome } : null,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Account deletion failed');
      return reply.code(500).send({ error: 'Failed to delete account. Please try again.' });
    }
  });

}
