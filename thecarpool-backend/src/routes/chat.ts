/**
 * In-app ride chat (MVP #5).
 * ─────────────────────────────────────────────────────
 * Text-only coordination between a ride's driver and its booked riders
 * without exposing phone numbers. Messages persist in Firestore under
 * chats/{ride_id}/messages and are broadcast in realtime over the existing
 * Socket.IO room (`ride_<id>`) that the trip screen already joins.
 *
 * Sending goes through REST (not the socket) so authorization, validation
 * and persistence share the same requireAuth/Zod path as every other route;
 * the socket is used purely as the realtime delivery channel.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, io } from '../server';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { sendPushToUser } from '../lib/fcm';

const SendMessageSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});

const HISTORY_LIMIT = 50;

/**
 * A user may chat on a ride if they are its driver or hold a non-cancelled
 * booking on it. Returns the ride data (for driver lookup) or null when the
 * caller is not a participant / ride doesn't exist.
 */
async function getRideIfParticipant(rideId: string, uid: string) {
  const rideDoc = await db.collection('rides').doc(rideId).get();
  if (!rideDoc.exists) return null;
  const ride = rideDoc.data()!;

  if (String(ride.driver_uid) === uid) return ride;

  const booking = await db.collection('bookings')
    .where('ride_id', '==', rideId)
    .where('rider_id', '==', uid)
    .limit(5)
    .get();
  const active = booking.docs.some((d) => d.data().status !== 'CANCELLED');
  return active ? ride : null;
}

/** All chat participants of a ride: the driver + every non-cancelled rider. */
async function getParticipantUids(rideId: string, ride: FirebaseFirestore.DocumentData): Promise<string[]> {
  const uids = new Set<string>();
  if (ride.driver_uid) uids.add(String(ride.driver_uid));
  const bookings = await db.collection('bookings').where('ride_id', '==', rideId).get();
  for (const doc of bookings.docs) {
    const b = doc.data();
    if (b.status !== 'CANCELLED' && b.rider_id) uids.add(String(b.rider_id));
  }
  return [...uids];
}

export async function chatRoutes(fastify: FastifyInstance) {

  // Message history — last 50, oldest first (ready to render top-to-bottom).
  fastify.get('/:ride_id/messages', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id } = request.params as { ride_id: string };
    const uid = String(request.user!.id);

    const ride = await getRideIfParticipant(ride_id, uid);
    if (!ride) {
      return reply.code(403).send({ error: 'You are not a participant of this ride.' });
    }

    const snap = await db.collection('chats').doc(ride_id).collection('messages')
      .orderBy('created_at', 'desc')
      .limit(HISTORY_LIMIT)
      .get();

    const messages = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .reverse();

    return reply.send({ ride_id, messages });
  });

  // Send a message: persist → broadcast to the ride room → push the others.
  fastify.post('/:ride_id/messages', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id } = request.params as { ride_id: string };
    const uid = String(request.user!.id);

    const body = parseOrReply(SendMessageSchema, request.body, reply);
    if (!body) return;

    const ride = await getRideIfParticipant(ride_id, uid);
    if (!ride) {
      return reply.code(403).send({ error: 'You are not a participant of this ride.' });
    }

    // Resolve a display name once so clients don't need a user lookup per message.
    const senderDoc = await db.collection('users').doc(uid).get();
    const senderName = senderDoc.exists
      ? (senderDoc.data()!.full_name || senderDoc.data()!.name || 'Co-traveller')
      : 'Co-traveller';

    const message = {
      sender_id: uid,
      sender_name: senderName,
      text: body.text,
      created_at: new Date().toISOString(),
    };
    const ref = await db.collection('chats').doc(ride_id).collection('messages').add(message);

    // Realtime delivery to everyone on the trip screen for this ride.
    io.to(`ride_${ride_id}`).emit('chat:message', { id: ref.id, ride_id, ...message });

    // Push-notify the other participants (best-effort, non-blocking response).
    const participants = await getParticipantUids(ride_id, ride);
    const preview = body.text.length > 80 ? `${body.text.slice(0, 77)}…` : body.text;
    await Promise.allSettled(
      participants
        .filter((p) => p !== uid)
        .map((p) => sendPushToUser(p, `💬 ${senderName}`, preview, { type: 'CHAT_MESSAGE', ride_id }))
    );

    return reply.code(201).send({ id: ref.id, ...message });
  });
}
