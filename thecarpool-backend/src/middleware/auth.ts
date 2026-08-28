import { FastifyRequest, FastifyReply } from 'fastify';
import * as admin from 'firebase-admin';
import { timingSafeEqual } from 'crypto';

// Extend FastifyRequest to include user object.
// id is the Firebase UID (a string), not a numeric id.
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      role: string;
      email?: string;
      /** E.164 phone from the token, when signed in with OTP or a linked phone. */
      phone?: string;
    };
  }
}

/**
 * Verifies the caller's Firebase ID token using the Admin SDK.
 *
 * The frontend (web + mobile) authenticates with Firebase Auth (Google
 * sign-in, phone OTP) and sends the resulting ID token as a Bearer token.
 * We verify it here against Firebase rather than a local JWT secret so the
 * two systems share a single source of truth.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized: Missing or invalid authorization token.' });
    }

    const token = authHeader.split(' ')[1];

    // Verify the Firebase ID token. Throws if expired, malformed, or not
    // signed by the project's Firebase Auth.
    const decoded = await admin.auth().verifyIdToken(token);

    // Custom claims (e.g. { admin: true }) can be set server-side via
    // admin.auth().setCustomUserClaims(uid, { role: 'ADMIN' }).
    request.user = {
      id: decoded.uid,
      role: (decoded.role as string) || (decoded.admin ? 'ADMIN' : 'USER'),
      email: decoded.email,
      phone: (decoded.phone_number as string) || undefined,
    };
  } catch (err: any) {
    request.log.error('Authentication failed: %s', err.message);
    return reply.code(401).send({ error: 'Unauthorized: Invalid token.' });
  }
}

/**
 * Authenticates AND requires the `admin` custom claim / ADMIN role.
 * Use as a preHandler on admin-only routes.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return; // requireAuth already rejected
  if (request.user?.role !== 'ADMIN') {
    return reply.code(403).send({ error: 'Forbidden: admin access required.' });
  }
}

/**
 * Auth for scheduled sweeps (Cloud Scheduler → Cloud Run).
 *
 * These endpoints move money and send messages, so they cannot be public — but
 * a scheduler cannot hold a Firebase ID token either: tokens expire in an hour
 * and there is no user to mint one. It presents a shared secret instead, and a
 * human admin can still call the same endpoint with their token.
 *
 * The comparison is timing-safe. A plain === leaks how much of the secret
 * matched via response timing, which is enough to recover it byte by byte.
 */
export async function requireCronOrAdmin(request: FastifyRequest, reply: FastifyReply) {
  const configured = process.env.CRON_SECRET;
  const supplied = request.headers['x-cron-key'];

  if (configured && typeof supplied === 'string') {
    const a = Buffer.from(configured);
    const b = Buffer.from(supplied);
    if (a.length === b.length && timingSafeEqual(a, b)) return; // authorised
  }

  // Not a scheduler call — fall back to a real admin user.
  return requireAdmin(request, reply);
}
