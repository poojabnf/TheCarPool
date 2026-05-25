import Fastify from 'fastify';
import { Pool } from 'pg';
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
import { seedGeographicDataIfEmpty } from './services/geoSeed';
import { setupTelemetrySocket } from './sockets/telemetry';

dotenv.config();

const fastify = Fastify({ logger: true });

// Setup PostgreSQL Client Pool
export const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:thecarpoolsecretpassword@localhost:5432/thecarpool',
});

// Verify connection
dbPool.connect((err, client, release) => {
  if (err) {
    fastify.log.error(err, 'PostgreSQL database connection failed:');
  } else {
    fastify.log.info('Successfully connected to PostgreSQL database (PostGIS enabled)');
    release();
    // Run self-healing database seeding check
    seedGeographicDataIfEmpty(dbPool).catch((seedingError) => {
      fastify.log.error('Automatic geographic database seeding failed:', seedingError);
    });
  }
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
