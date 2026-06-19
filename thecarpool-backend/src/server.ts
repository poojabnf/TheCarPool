import Fastify from 'fastify';
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
import { setupTelemetrySocket } from './sockets/telemetry';
import { initSentry, captureError } from './lib/sentry';

dotenv.config();

// Fail fast on missing critical secrets (production); warn on optional ones.
validateEnv();

// Initialise error monitoring before anything else (no-op without SENTRY_DSN).
initSentry();

const fastify = Fastify({ logger: true });

// Security headers, CORS allowlist, and a global rate limit. Registered before
// routes so they apply to every endpoint. The CORS/Socket.IO origin allowlist
// is driven by CORS_ALLOWED_ORIGINS (comma-separated; '*' to allow all).
fastify.register(helmet, { contentSecurityPolicy: false });
fastify.register(cors, { origin: allowedOrigins(), credentials: true });
fastify.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX || 200),
  timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
  allowList: ['127.0.0.1'],
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

// Run self-healing Firestore database seeding check in background on boot
import { seedFirestoreIfEmpty } from './services/firestoreSeed';
seedFirestoreIfEmpty().then(() => {
  fastify.log.info('Firestore database collections verified and seeded successfully.');
}).catch((err) => {
  fastify.log.error('Firestore database auto-seeding failed:', err);
});

// Attach Socket.IO to Fastify's underlying HTTP server so both the REST API
// (handled by Fastify) and websockets share one port.
const io = new SocketIOServer(fastify.server, {
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

start();
