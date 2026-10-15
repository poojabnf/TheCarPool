import Fastify from 'fastify';
import { timingSafeEqual } from 'crypto';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createClient } from 'redis';
import { Server as SocketIOServer } from 'socket.io';
import * as dotenv from 'dotenv';
import { validateEnv, allowedOrigins } from './lib/config';
import { rideRoutes } from './routes/rides';
import { bookingRoutes } from './routes/bookings';
import { safetyRoutes } from './routes/safety';
import { sustainabilityRoutes } from './routes/sustainability';
import { aiRoutes } from './routes/ai';
import { paymentRoutes } from './routes/payments';
import { classifiedRoutes } from './routes/classifieds';
import { geoRoutes } from './routes/geo';
import { userRoutes } from './routes/users';
import { notificationRoutes } from './routes/notifications';
import { setupTelemetrySocket } from './sockets/telemetry';
import { initSentry, captureError } from './lib/sentry';

dotenv.config();

// Fail fast on missing critical secrets (production); warn on optional ones.
validateEnv();

// Initialise error monitoring before anything else (no-op without SENTRY_DSN).
initSentry();

// Default is 1 MiB, which a base64-encoded camera photo (avatars, classified
// listing photos) blows past routinely — raised to fit those.
// trustProxy, because Cloud Run terminates TLS in front of us: without it
// request.ip is the load balancer's address for every caller, so an IP-keyed
// rate limit becomes one global bucket that any single client can exhaust for
// everyone.
//
// A hop count, not `true`. With `true` every X-Forwarded-For entry is trusted
// and request.ip is the leftmost one, which the client writes: a forged header
// gave a fresh rate-limit bucket per request. Cloud Run adds exactly one hop,
// so request.ip is now the address that proxy saw.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);
const fastify = Fastify({ logger: true, bodyLimit: 15 * 1024 * 1024, trustProxy: TRUST_PROXY_HOPS });

// Security headers, CORS allowlist, and a global rate limit. Registered before
// routes so they apply to every endpoint. The CORS/Socket.IO origin allowlist
// is driven by CORS_ALLOWED_ORIGINS (comma-separated; '*' to allow all).
fastify.register(helmet, { contentSecurityPolicy: false });
fastify.register(cors, { origin: allowedOrigins(), credentials: true });
// Rate limit per SIGNED-IN USER, not per IP.
//
// Keyed on the IP, two phones on the same WiFi shared one budget -- which is
// the ordinary case for this app (a driver and a rider testing together, a
// family, an office) and it broke real flows: 225 requests were refused in one
// 40-minute session, including a payment order, a ride creation, and the
// driver's pending-request list. One person's open dashboard could starve
// everyone behind the same router.
//
// The uid comes from the Authorization header rather than request.user,
// because rate limiting runs before authentication. It is only a bucket key,
// never a trust decision -- a forged token yields a nonsense bucket, which is
// no better for an attacker than the IP they would otherwise get.
fastify.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
  // The scheduled sweeps are what SEND departure and boarding reminders, and
  // they were being refused -- one 429 on /notify-upcoming and one on
  // /notify-boarding in a single session, meaning neither reminder went out at
  // all. They carry CRON_SECRET, run a handful of times an hour, and cannot be
  // triggered by a user, so they have no business sharing a user's budget.
  // No localhost exemption: behind a proxy a loopback address is just another
  // value a client could get into request.ip.
  allowList: (request) => {
    const secret = process.env.CRON_SECRET;
    const header = request.headers['x-cron-key'];
    if (!secret || typeof header !== 'string') return false;
    const a = Buffer.from(secret);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
  },
  /**
   * Keyed on the client address, and only that.
   *
   * This used to read the uid out of the JWT payload to give each user their
   * own budget. The payload was decoded, never verified -- the limiter runs
   * before authentication, so there is no verified identity to reach for --
   * which meant anyone could mint a fresh bucket per request by writing a
   * different `sub` into an unsigned token. A rate limit that an attacker can
   * opt out of protects nobody; the honest users it was separating were the
   * only ones it still applied to.
   *
   * An address is the one thing that cannot be forged at this point in the
   * request. The per-user fairness that keying on uid was buying has to come
   * from limits applied after authentication, not before it.
   */
  keyGenerator: (request) => request.ip,
});

// Forward unhandled route errors to Sentry, then fall through to the default
// Fastify error response.
fastify.addHook('onError', async (_request, _reply, error) => {
  captureError(error);
});

// Capture the raw request body alongside the parsed JSON so payment webhooks
// can verify HMAC signatures against the exact bytes Razorpay sent.
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as any).rawBody = body;
  try {
    done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

// Setup Firestore database and storage client and re-export for routes
export { db, storage } from './lib/firestore';

// Seed demo data when the database is empty — development convenience only.
//
// This used to run on every boot, including production. With min-instances=0
// the service cold-starts constantly, so that meant a Firestore read per cold
// start, purely to re-learn that the database is not empty: billable, and it
// competes for CPU during the startup window that users are waiting on.
//
// A populated production database can never need seeding, so it is off unless
// SEED_FIRESTORE=true.
if (process.env.SEED_FIRESTORE === 'true') {
  import('./services/firestoreSeed').then(({ seedFirestoreIfEmpty }) =>
    seedFirestoreIfEmpty()
      .then(() => fastify.log.info('Firestore database collections verified and seeded successfully.'))
      .catch((err) => fastify.log.error('Firestore database auto-seeding failed:', err))
  );
}

// Attach Socket.IO to Fastify's underlying HTTP server so both the REST API
// (handled by Fastify) and websockets share one port.
export const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: allowedOrigins(),
  }
});

// Setup Redis Cache Client (optional — app works without it, caching is bypassed)
export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    // Only attempt once — no exponential backoff spam in logs when Redis is not running locally
    reconnectStrategy: (retries) => {
      if (retries >= 1) {
        fastify.log.warn('Redis not available — caching disabled. Start Redis or set REDIS_URL to enable.');
        return false; // Stop retrying
      }
      return 500; // wait 500ms before first retry
    }
  }
});

let redisAvailable = false;
redisClient.on('error', () => { /* suppressed after reconnectStrategy logs once */ });
redisClient.on('connect', () => {
  redisAvailable = true;
  fastify.log.info('Successfully connected to Redis Cache');
});

// Attempt connection — failure is silent after the first warning
redisClient.connect().catch(() => {});

// Register real-time telemetry events
setupTelemetrySocket(io, fastify.log);

// Register API Routes
fastify.register(rideRoutes, { prefix: '/api/rides' });
fastify.register(bookingRoutes, { prefix: '/api/bookings' });
fastify.register(safetyRoutes, { prefix: '/api/safety' });
fastify.register(sustainabilityRoutes, { prefix: '/api/sustainability' });
fastify.register(aiRoutes, { prefix: '/api/ai' });
fastify.register(paymentRoutes, { prefix: '/api/payments' });
fastify.register(classifiedRoutes, { prefix: '/api/classifieds' });
fastify.register(geoRoutes, { prefix: '/api/geo' });
fastify.register(userRoutes, { prefix: '/api/users' });
fastify.register(notificationRoutes, { prefix: '/api/notifications' });

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'OK', service: 'TheCarPool Gateway', timestamp: new Date() };
});

const PORT = parseInt(process.env.PORT || '5000', 10);

const start = async () => {
  try {
    // fastify.listen makes Fastify ready (routes registered) and binds the
    // HTTP server that Socket.IO is attached to.
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`TheCarPool API Gateway and Socket server running on port ${PORT}`);
  } catch (err) {
    captureError(err);
    fastify.log.error(err);
    process.exit(1);
  }
};

/**
 * Drain cleanly when Cloud Run shuts the instance down.
 *
 * Cloud Run sends SIGTERM and then kills the container ~10s later. Without a
 * handler, in-flight requests are cut mid-response and Socket.IO clients see
 * an abrupt drop — which matters most during a deploy, when every instance is
 * replaced. fastify.close() stops accepting new connections and waits for
 * the ones already running.
 *
 * Guarded so a second signal during shutdown does not start it twice, and
 * force-exits if draining stalls, because being killed at the deadline with
 * no log is worse than exiting deliberately.
 */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  fastify.log.info(`${signal} received — draining`);

  const force = setTimeout(() => {
    fastify.log.error('Drain timed out — exiting anyway');
    process.exit(1);
  }, 8000);
  // Do not let the timer itself keep the process alive once draining is done.
  force.unref?.();

  try {
    io.close();
    await fastify.close();
    if (redisClient.isOpen) await redisClient.quit();
    fastify.log.info('Drained cleanly');
    process.exit(0);
  } catch (err) {
    captureError(err);
    fastify.log.error(err, 'Error while draining');
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => { void shutdown(sig); });
  }
  start();
}
