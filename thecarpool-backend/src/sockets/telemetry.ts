import { Server as SocketIOServer, Socket } from 'socket.io';
import { dbPool } from '../server';

interface TelemetryPayload {
  userId: number;
  lng: number;
  lat: number;
  speed: number;
  bearing: number;
  rideId?: number; // active ride
}

export function setupTelemetrySocket(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    // Join ride-specific room for broadcasts
    socket.on('ride:join', (rideId: number) => {
      socket.join(`ride_${rideId}`);
      console.log(`Socket ${socket.id} joined channel: ride_${rideId}`);
    });

    // Ingest telemetry update from mobile device
    socket.on('telemetry:update', async (data: TelemetryPayload) => {
      const { userId, lng, lat, speed, bearing, rideId } = data;

      try {
        // Upsert coordinates to database
        const query = `
          INSERT INTO device_coordinates (user_id, current_location, speed, bearing, last_updated)
          VALUES (
            $1, 
            ST_SetSRID(ST_MakePoint($2, $3), 4326), 
            $4, 
            $5, 
            NOW()
          )
          ON CONFLICT (user_id) DO UPDATE SET
            current_location = EXCLUDED.current_location,
            speed = EXCLUDED.speed,
            bearing = EXCLUDED.bearing,
            last_updated = NOW();
        `;
        await dbPool.query(query, [userId, lng, lat, speed, bearing]);

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
          // Verify if driver's current position is within 100 meters of the scheduled route
          const geofenceQuery = `
            SELECT 
              ST_DWithin(
                r.route_line::geography,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                100
              ) as within_limits
            FROM rides r
            WHERE r.id = $3;
          `;
          const geofenceRes = await dbPool.query(geofenceQuery, [lng, lat, rideId]);
          
          if (geofenceRes.rows.length > 0 && !geofenceRes.rows[0].within_limits) {
            // Dispatch geofence breach warning to riders and dashboard alert listeners
            io.to(`ride_${rideId}`).emit('safety:alert', {
              type: 'GEOFENCE_BREACH',
              message: 'Warning: Driver has deviated from the planned route path by > 100 meters.',
              coordinates: { lng, lat }
            });
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
