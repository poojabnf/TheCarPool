import Fastify from 'fastify';
import { createClient } from 'redis';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as dotenv from 'dotenv';
import { rideRoutes } from './routes/rides';
import { bookingRoutes } from './routes/bookings';
import { safetyRoutes } from './routes/safety';
import { sustainabilityRoutes } from './routes/sustainability';
import { aiRoutes } from './routes/ai';
import { paymentRoutes } from './routes/payments';
import { classifiedRoutes } from './routes/classifieds';
import { geoRoutes } from './routes/geo';
import { setupTelemetrySocket } from './sockets/telemetry';

dotenv.config();

const fastify = Fastify({ logger: true });

// Setup Firestore database and storage client and re-export for routes
export { db, storage } from './lib/firestore';

// Run self-healing Firestore database seeding check in background on boot
import { seedFirestoreIfEmpty } from './services/firestoreSeed';
seedFirestoreIfEmpty().then(() => {
  fastify.log.info('Firestore database collections verified and seeded successfully.');
}).catch((err) => {
  fastify.log.error('Firestore database auto-seeding failed:', err);
});

// Setup Sockets integrated with HTTP server
const server = createServer(fastify.server);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
  }
});

// Setup Redis Cache Client
export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => fastify.log.error('Redis Client Error', err));
redisClient.on('connect', () => fastify.log.info('Successfully connected to Redis Cache'));

// Connect Redis before booting
redisClient.connect().catch(console.error);

// Register real-time telemetry events
setupTelemetrySocket(io);

// Register API Routes
fastify.register(rideRoutes, { prefix: '/api/rides' });
fastify.register(bookingRoutes, { prefix: '/api/bookings' });
fastify.register(safetyRoutes, { prefix: '/api/safety' });
fastify.register(sustainabilityRoutes, { prefix: '/api/sustainability' });
fastify.register(aiRoutes, { prefix: '/api/ai' });
fastify.register(paymentRoutes, { prefix: '/api/payments' });
fastify.register(classifiedRoutes, { prefix: '/api/classifieds' });
fastify.register(geoRoutes, { prefix: '/api/geo' });

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'OK', service: 'TheCarPool Gateway', timestamp: new Date() };
});

const PORT = parseInt(process.env.PORT || '5000', 10);

const start = async () => {
  try {
    // We bind to fastify's internal server instance through our HTTP server wrapper
    server.listen(PORT, '0:0:0:0', () => {
      fastify.log.info(`TheCarPool API Gateway and Socket server running on port ${PORT}`);
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
