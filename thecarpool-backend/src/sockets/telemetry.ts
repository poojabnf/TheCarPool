import { Server as SocketIOServer, Socket } from 'socket.io';
import { db } from '../server';
import * as jwt from 'jsonwebtoken';

interface TelemetryPayload {
  userId: number;
  lng: number;
  lat: number;
  speed: number;
  bearing: number;
  rideId?: number; // active ride
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

export function setupTelemetrySocket(io: SocketIOServer) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication error: Token missing"));
    }
    try {
      const secret = process.env.JWT_SECRET || 'thecarpool_jwt_secret_dev_only';
      const decoded = jwt.verify(token, secret) as any;
      (socket as any).userId = parseInt(decoded.sub || decoded.uid || decoded.user_id, 10);
      next();
    } catch (err) {
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log(`Socket client connected: ${socket.id}, User ID: ${(socket as any).userId}`);

    // Join ride-specific room for broadcasts
    socket.on('ride:join', (rideId: number) => {
      socket.join(`ride_${rideId}`);
      console.log(`Socket ${socket.id} joined channel: ride_${rideId}`);
    });

    // Ingest telemetry update from mobile device
    socket.on('telemetry:update', async (data: TelemetryPayload) => {
      const { userId, lng, lat, speed, bearing, rideId } = data;

      if ((socket as any).userId !== userId) {
        console.error(`User ${(socket as any).userId} attempted to spoof telemetry for user ${userId}`);
        return;
      }

      try {
        // Upsert coordinates to Firestore
        await db.collection('device_coordinates').doc(String(userId)).set({
          user_id: String(userId),
          current_location: { lat, lng },
          speed,
          bearing,
          last_updated: new Date().toISOString()
        }, { merge: true });

        // Broadcast to matched passengers listening on the channel
        if (rideId) {
          io.to(`ride_${rideId}`).emit('telemetry:broadcast', {
            userId,
            lng,
            lat,
            speed,
            bearing,
            timestamp: new Date()
          });

          // Perform automated geofence verification
          // Fetch ride
          const rideRef = db.collection('rides').doc(String(rideId));
          const rideDoc = await rideRef.get();
          if (rideDoc.exists) {
            const ride = rideDoc.data()!;
            const route_coords = ride.route_coords || [];

            // Check if any point along the route is within 100 meters
            let withinLimits = false;
            for (const pt of route_coords) {
              const distance = haversineDistance(lat, lng, pt.lat, pt.lng);
              if (distance <= 100) {
                withinLimits = true;
                break;
              }
            }

            if (!withinLimits && route_coords.length > 0) {
              // Dispatch geofence breach warning to riders and dashboard alert listeners
              io.to(`ride_${rideId}`).emit('safety:alert', {
                type: 'GEOFENCE_BREACH',
                message: 'Warning: Driver has deviated from the planned route path by > 100 meters.',
                coordinates: { lng, lat }
              });
            }
          }
        }
      } catch (err) {
        console.error('Telemetry processing failed:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket client disconnected: ${socket.id}`);
    });
  });
}
