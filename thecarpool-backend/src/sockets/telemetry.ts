import { Server as SocketIOServer, Socket } from 'socket.io';
import * as admin from 'firebase-admin';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../server';
import { sendPushToUser } from '../lib/fcm';
import { isArrivingAtPickup } from '../lib/rideNotifications';
import { isBookingActive } from '../lib/cashRides';
import { nextStallState, type StallState } from '../lib/stallDetection';

// Telemetry is accepted at most this often per socket.
const TELEMETRY_MIN_INTERVAL_MS = 2000;

// Route-deviation escalation: a single out-of-corridor ping can be GPS noise,
// but this many consecutive breaches means the vehicle has genuinely left the
// planned route — persist a safety alert and push-notify every booked rider.
const BREACH_ESCALATION_THRESHOLD = 3;

interface TelemetryPayload {
  userId: string;
  lng: number;
  lat: number;
  speed: number;
  bearing: number;
  rideId?: number; // active ride
}

/**
 * Short-lived per-ride cache for the two documents every tick used to refetch.
 *
 * A moving vehicle emits telemetry roughly every 5 seconds, and each tick was
 * doing a ride read plus a whole-collection bookings query. That is two
 * Firestore operations per driver per 5s for the entire duration of every
 * trip, to re-read data that barely changes: route_coords are fixed once the
 * ride is posted, and the booking set changes only when someone books or
 * boards.
 *
 * The TTL is what keeps it honest — a rider who books mid-trip, or who has
 * just been verified, is picked up within CACHE_TTL_MS. Entries are dropped
 * when the socket disconnects, so this cannot grow without bound.
 */
const CACHE_TTL_MS = 30_000;

interface RideCacheEntry { at: number; routeCoords: { lat: number; lng: number }[] | null; status?: string }
interface BookingsCacheEntry { at: number; docs: { id: string; data: FirebaseFirestore.DocumentData }[] }

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

export function setupTelemetrySocket(io: SocketIOServer, log: FastifyBaseLogger) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication error: Token missing"));
    }
    try {
      // Verify the Firebase ID token — same source of truth as the REST API.
      const decoded = await admin.auth().verifyIdToken(token);
      (socket as any).userId = decoded.uid;
      next();
    } catch (err) {
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on('connection', (socket: Socket) => {
    log.info({ socketId: socket.id, userId: (socket as any).userId }, 'Socket client connected');

    // Per-connection deviation tracking (keyed by ride so a driver running
    // back-to-back rides doesn't carry a stale count across trips).
    const breachStreak = new Map<string, number>();
    const escalatedRides = new Set<string>();
    // Per-connection, so they die with the socket rather than leaking.
    const rideCache = new Map<string, RideCacheEntry>();
    const bookingsCache = new Map<string, BookingsCacheEntry>();
    // One "driver is arriving" push per booking, per connection. Without this
    // it would repeat on every telemetry tick while the driver sits waiting.
    const arrivalNotified = new Set<string>();
    // Rides this socket is the driver of, recorded on ride:join. Only the
    // driver may publish a ride's location; anyone else could otherwise push
    // fake positions, geofence alerts and rider notifications into any ride.
    const drivenRides = new Set<string>();
    const stallState = new Map<string, StallState>();
    let lastTelemetryAt = 0;

    // Join ride-specific room for broadcasts (restricted to ride participants)
    socket.on('ride:join', async (rideId: number | string) => {
      const authedUid = String((socket as any).userId || '');
      if (!authedUid) {
        log.warn({ socketId: socket.id, rideId }, 'Unauthenticated socket rejected from ride channel');
        return;
      }
      try {
        const rideSnap = await db.collection('rides').doc(String(rideId)).get();
        if (!rideSnap.exists) return;
        const rideData = rideSnap.data()!;
        const isDriver = String(rideData.driver_uid || rideData.driver_id) === authedUid;
        let isPassenger = false;

        if (!isDriver) {
          const bookingSnap = await db.collection('bookings')
            .where('ride_id', '==', String(rideId))
            .where('rider_id', '==', authedUid)
            .get();
          isPassenger = bookingSnap.docs.some((d) => {
            const b = d.data();
            return b.booking_status === 'CONFIRMED' || b.escrow_status === 'HELD' || b.escrow_status === 'SETTLED';
          });
        }

        if (isDriver || isPassenger || (socket as any).userRole === 'ADMIN') {
          socket.join(`ride_${rideId}`);
          if (isDriver) drivenRides.add(String(rideId));
          log.info({ socketId: socket.id, rideId, authedUid }, 'Authorized socket joined ride channel');
        } else {
          log.warn({ socketId: socket.id, rideId, authedUid }, 'Unauthorized socket rejected from ride channel');
        }
      } catch (err) {
        log.error(err, 'Failed to authorize socket for ride channel');
      }
    });

    // Ingest telemetry update from mobile device
    socket.on('telemetry:update', async (data: TelemetryPayload) => {
      const { userId, lng, lat, speed, bearing, rideId } = data;

      if ((socket as any).userId !== userId) {
        log.warn({ authedUser: (socket as any).userId, claimedUser: userId }, 'Telemetry user-id spoof attempt blocked');
        return;
      }
      if (
        typeof lat !== 'number' || typeof lng !== 'number' ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        return;
      }
      const nowMs = Date.now();
      if (nowMs - lastTelemetryAt < TELEMETRY_MIN_INTERVAL_MS) return;
      lastTelemetryAt = nowMs;
      if (rideId && !drivenRides.has(String(rideId))) {
        log.warn({ authedUser: userId, rideId }, 'Telemetry for a ride the sender does not drive blocked');
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
          const rideCacheKey = String(rideId);
          let rideEntry = rideCache.get(rideCacheKey);
          if (!rideEntry || Date.now() - rideEntry.at > CACHE_TTL_MS) {
            const rideDoc = await db.collection('rides').doc(rideCacheKey).get();
            rideEntry = {
              at: Date.now(),
              routeCoords: rideDoc.exists ? (rideDoc.data()!.route_coords || []) : null,
              status: rideDoc.exists ? String(rideDoc.data()!.status || '') : undefined,
            };
            rideCache.set(rideCacheKey, rideEntry);
          }
          if (rideEntry.routeCoords !== null) {
            const route_coords = rideEntry.routeCoords;

            // Check if any point along the route is within 100 meters
            let withinLimits = false;
            for (const pt of route_coords) {
              const distance = haversineDistance(lat, lng, pt.lat, pt.lng);
              if (distance <= 100) {
                withinLimits = true;
                break;
              }
            }

            const rideKey = String(rideId);

            // ── "Your driver is arriving" ───────────────────────────────────
            // Runs on EVERY telemetry tick, deliberately outside the
            // route-deviation branch — a driver approaching the pickup is
            // normally well ON route, so nesting this under a deviation would
            // mean it fired only when something had gone wrong.
            // Once per booking, and only for riders who haven't boarded yet.
            try {
              let bookingsEntry = bookingsCache.get(rideKey);
              if (!bookingsEntry || Date.now() - bookingsEntry.at > CACHE_TTL_MS) {
                const pending = await db.collection('bookings')
                  .where('ride_id', '==', rideKey)
                  .where('escrow_status', '==', 'HELD')
                  .get();
                bookingsEntry = {
                  at: Date.now(),
                  docs: pending.docs.map((d) => ({ id: d.id, data: d.data() })),
                };
                bookingsCache.set(rideKey, bookingsEntry);
              }
              for (const bk of bookingsEntry.docs) {
                const b = bk.data;
                if (b.boarding_verified === true) continue;
                if (arrivalNotified.has(bk.id)) continue;
                if (!isArrivingAtPickup({ lat, lng }, b.pickup_point)) continue;
                arrivalNotified.add(bk.id);
                sendPushToUser(
                  String(b.rider_id),
                  '🚗 Your driver is arriving',
                  'Your driver is close to the pickup point. Please head out — have your 4-digit boarding code ready.',
                  { type: 'DRIVER_ARRIVING', ride_id: rideKey, booking_id: bk.id }
                );
              }
            } catch (e) {
              log.error(e, 'Arrival proximity check failed');
            }

            // Stalled-vehicle check-in: same spot for 10+ minutes mid-trip.
            if (rideEntry.status === 'STARTED' || rideEntry.status === 'IN_PROGRESS') {
              const st = nextStallState(stallState.get(rideKey), lat, lng, Date.now(), haversineDistance);
              stallState.set(rideKey, st.state);
              if (st.shouldAlert) {
                log.warn({ rideId }, 'Vehicle stationary for 10+ minutes during trip');
                await db.collection('safety_alerts').add({
                  type: 'VEHICLE_STALLED',
                  ride_id: rideKey,
                  driver_user_id: String(userId),
                  coordinates: { lat, lng },
                  created_at: new Date().toISOString(),
                  status: 'OPEN',
                });
                io.to(`ride_${rideId}`).emit('safety:alert', {
                  type: 'VEHICLE_STALLED',
                  message: 'The vehicle has not moved for 10 minutes.',
                  coordinates: { lng, lat },
                });
                const bks = await db.collection('bookings').where('ride_id', '==', rideKey).get();
                const riders = [...new Set(bks.docs.filter((b) => isBookingActive(b.data().escrow_status)).map((b) => String(b.data().rider_id)))];
                await Promise.allSettled(riders.map((rider) => sendPushToUser(
                  rider,
                  'Are you OK?',
                  'Your ride has not moved for 10 minutes. Open the trip screen — use SOS if you need help.',
                  { type: 'VEHICLE_STALLED', ride_id: rideKey }
                )));
              }
            }

            if (!withinLimits && route_coords.length > 0) {
              // Dispatch geofence breach warning to riders and dashboard alert listeners
              io.to(`ride_${rideId}`).emit('safety:alert', {
                type: 'GEOFENCE_BREACH',
                message: 'Warning: Driver has deviated from the planned route path by > 100 meters.',
                coordinates: { lng, lat }
              });

              // Escalate after sustained deviation: persist an auditable alert
              // and push-notify every booked rider (once per ride per session).
              const streak = (breachStreak.get(rideKey) || 0) + 1;
              breachStreak.set(rideKey, streak);
              if (streak >= BREACH_ESCALATION_THRESHOLD && !escalatedRides.has(rideKey)) {
                escalatedRides.add(rideKey);
                log.warn({ rideId, streak }, 'Sustained route deviation — escalating to safety alert');

                await db.collection('safety_alerts').add({
                  type: 'ROUTE_DEVIATION',
                  ride_id: rideKey,
                  driver_user_id: String(userId),
                  coordinates: { lat, lng },
                  consecutive_breaches: streak,
                  created_at: new Date().toISOString(),
                  status: 'OPEN',
                });

                const bookings = await db.collection('bookings')
                  .where('ride_id', '==', rideKey)
                  .get();
                const riderUids = [...new Set(
                  bookings.docs
                    .filter((b) => isBookingActive(b.data().escrow_status))
                    .map((b) => String(b.data().rider_id))
                )];
                await Promise.allSettled(riderUids.map((rider) =>
                  sendPushToUser(
                    rider,
                    '⚠️ Route deviation detected',
                    'Your ride has left the planned route. Open the trip screen — use SOS if you feel unsafe.',
                    { type: 'ROUTE_DEVIATION', ride_id: rideKey }
                  )
                ));
              }
            } else {
              // Back inside the corridor — reset the streak (noise, brief detour).
              breachStreak.delete(rideKey);
            }
          }
        }
      } catch (err) {
        log.error(err, 'Telemetry processing failed');
      }
    });

    socket.on('disconnect', () => {
      log.info({ socketId: socket.id }, 'Socket client disconnected');
    });
  });
}
