import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { db, redisClient } from '../server';
import { requireAuth } from '../middleware/auth';

interface CreateRideBody {
  driver_id: string | number;
  route_geojson: any; // GeoJSON LineString representing route
  seats_total: number;
  price_split: number;
  departure_time: string;
  vehicle_type?: 'CAR' | 'BIKE';
  music_allowed?: boolean;
  smoking_allowed?: boolean;
  chattiness?: 'QUIET' | 'MEDIUM' | 'TALKATIVE';
  ac_available?: boolean;
}

interface SearchRideBody {
  pickup_lng: number;
  pickup_lat: number;
  drop_lng: number;
  drop_lat: number;
  max_detour_meters?: number;
  gender_preference?: 'MALE' | 'FEMALE' | 'ANY';
  company_domain?: string;
  society_name?: string;
  ev_only?: boolean;
  vehicle_type?: 'CAR' | 'BIKE' | 'ANY';
  music_allowed?: boolean;
  smoking_allowed?: boolean;
  chattiness?: 'QUIET' | 'MEDIUM' | 'TALKATIVE' | 'ANY';
  ac_available?: boolean;
}

// Helpers for robust ID resolution (handling formats like "1" and "user_1")
async function getUserDoc(userId: string | number) {
  const sId = String(userId);
  let ref = db.collection('users').doc(sId);
  let doc = await ref.get();
  if (!doc.exists) {
    if (sId.startsWith('user_')) {
      ref = db.collection('users').doc(sId.substring(5));
      doc = await ref.get();
    } else {
      ref = db.collection('users').doc('user_' + sId);
      doc = await ref.get();
    }
  }
  return doc;
}

async function getDriverDoc(driverId: string | number) {
  const sId = String(driverId);
  let ref = db.collection('drivers').doc(sId);
  let doc = await ref.get();
  if (!doc.exists) {
    if (sId.startsWith('driver_')) {
      ref = db.collection('drivers').doc(sId.substring(7));
      doc = await ref.get();
    } else {
      ref = db.collection('drivers').doc('driver_' + sId);
      doc = await ref.get();
    }
  }
  return doc;
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

// Max candidate rides scanned per search — caps memory/CPU so a large
// rides collection can't OOM the process during in-memory matching.
const MAX_RIDE_SCAN = 500;
const DEFAULT_RESULT_LIMIT = 50;

// Cheap bounding-box test: does the ride's route pass within `detourMeters`
// of BOTH the pickup and drop points? Used to skip the expensive per-point
// haversine pass for rides that are obviously far away.
function routeBboxIntersects(
  routeCoords: { lat: number; lng: number }[],
  pickupLat: number, pickupLng: number,
  dropLat: number, dropLng: number,
  detourMeters: number
): boolean {
  if (routeCoords.length === 0) return false;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const pt of routeCoords) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }
  // Expand the bbox by the detour tolerance (degrees). 111320 m ≈ 1° lat.
  const latPad = detourMeters / 111320;
  const midLat = (minLat + maxLat) / 2;
  const lngPad = detourMeters / (111320 * Math.max(Math.cos((midLat * Math.PI) / 180), 0.01));
  const inBox = (lat: number, lng: number) =>
    lat >= minLat - latPad && lat <= maxLat + latPad &&
    lng >= minLng - lngPad && lng <= maxLng + lngPad;
  return inBox(pickupLat, pickupLng) && inBox(dropLat, dropLng);
}

export async function rideRoutes(fastify: FastifyInstance) {
  
  // 1. Create a ride with LineString geometry
  fastify.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const {
      driver_id, route_geojson, seats_total, price_split, departure_time,
      vehicle_type = 'CAR', music_allowed = true, smoking_allowed = false,
      chattiness = 'MEDIUM', ac_available = true
    } = request.body as CreateRideBody;

    const uid = String(request.user!.id);
    // The driver always offers under their own identity. A client-supplied
    // driver_id is only honoured if it resolves to the caller's own profile.
    const requestedDriverId = driver_id != null ? String(driver_id) : uid;

    // Required ride fields.
    if (seats_total == null || price_split == null || !departure_time) {
      return reply.code(400).send({ error: 'seats_total, price_split and departure_time are required.' });
    }
    if (Number(seats_total) <= 0 || Number(price_split) < 0) {
      return reply.code(400).send({ error: 'seats_total must be positive and price_split non-negative.' });
    }

    try {
      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.data();
      if (userData?.kyc_status !== 'VERIFIED') {
        return reply.code(403).send({
          error: 'VERIFICATION_REQUIRED',
          message: 'Complete identity verification to offer a ride.',
        });
      }
      if (userData?.kyc_simulated === true) {
        return reply.code(403).send({
          error: 'REAL_VERIFICATION_REQUIRED',
          message: 'A simulated KYC check is insufficient for driver privileges.',
        });
      }

      // Resolve the caller's driver profile, auto-provisioning one on first
      // offer. Any KYC-verified user may become a driver; we never provision a
      // profile for a different user's id.
      let driverDoc = await getDriverDoc(requestedDriverId);
      let resolvedDriverId = requestedDriverId;

      if (!driverDoc.exists) {
        if (requestedDriverId !== uid) {
          return reply.code(403).send({ error: 'Forbidden: You do not own this driver profile.' });
        }
        // Provision a driver profile keyed on the user's uid.
        await db.collection('drivers').doc(uid).set({
          user_id: uid,
          vehicle_type,
          is_ev: false,
          created_at: new Date().toISOString(),
        }, { merge: true });
        driverDoc = await db.collection('drivers').doc(uid).get();
        resolvedDriverId = uid;
      }

      const driverData = driverDoc.data()!;
      if (String(driverData.user_id) !== uid && String(driverData.user_id) !== `user_${uid}`) {
        return reply.code(403).send({ error: 'Forbidden: You do not own this driver profile.' });
      }

      let routeCoords: { lat: number; lng: number }[] = [];
      if (route_geojson) {
        try {
          const geojson = typeof route_geojson === 'string' ? JSON.parse(route_geojson) : route_geojson;
          if (geojson && geojson.type === 'LineString' && Array.isArray(geojson.coordinates)) {
            routeCoords = geojson.coordinates.map((coord: any) => ({
              lat: coord[1],
              lng: coord[0]
            }));
          }
        } catch (err: any) {
          fastify.log.error(err, 'Failed to parse route_geojson');
        }
      }

      const rideId = 'ride_' + randomUUID();
      const newRide = {
        id: rideId,
        driver_id: String(resolvedDriverId),
        driver_uid: uid, // used by settlement/cancellation to credit the driver
        route_coords: routeCoords,
        seats_total: Number(seats_total),
        seats_available: Number(seats_total),
        price_split: Number(price_split),
        departure_time,
        vehicle_type,
        music_allowed,
        smoking_allowed,
        chattiness,
        ac_available,
        status: 'SCHEDULED',
        created_at: new Date().toISOString()
      };

      await db.collection('rides').doc(rideId).set(newRide);
      return reply.code(201).send(newRide);
    } catch (err: any) {
      fastify.log.error('Failed to create ride:', err);
      return reply.code(500).send({ error: 'Database failure to register ride route.' });
    }
  });

  // 2. Spatial carpool matching search query with dynamic filters and Redis caching
  fastify.post('/search', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = request.body as SearchRideBody;
    const { 
      pickup_lng, pickup_lat, drop_lng, drop_lat, max_detour_meters = 1500,
      gender_preference, company_domain, society_name, ev_only = false,
      vehicle_type = 'ANY', music_allowed, smoking_allowed, chattiness = 'ANY', ac_available
    } = body;

    // Validate bounds
    if (pickup_lat > 90 || pickup_lat < -90 || drop_lat > 90 || drop_lat < -90 || pickup_lng > 180 || pickup_lng < -180 || drop_lng > 180 || drop_lng < -180) {
      return reply.code(400).send({ error: 'Invalid coordinates' });
    }

    // Build Cache Key securely
    const cacheKey = `search:${pickup_lng},${pickup_lat},${drop_lng},${drop_lat},${max_detour_meters},${gender_preference || 'ANY'},${company_domain || 'NONE'},${society_name || 'NONE'},${ev_only},${vehicle_type},${music_allowed ?? 'ANY'},${smoking_allowed ?? 'ANY'},${chattiness},${ac_available ?? 'ANY'}`;
    
    try {
      // 1. Check Redis Cache
      if (redisClient.isOpen) {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          fastify.log.info(`[CACHE HIT] Returning matched routes for: ${cacheKey}`);
          return reply.send(JSON.parse(cachedData));
        }
      }

      // Fetch scheduled rides that haven't departed yet, ordered by departure
      // and capped so a huge collection can't be pulled fully into memory.
      const now = new Date().toISOString();
      const snap = await db.collection('rides')
        .where('status', '==', 'SCHEDULED')
        .where('departure_time', '>', now)
        .orderBy('departure_time', 'asc')
        .limit(MAX_RIDE_SCAN)
        .get();

      const rides: any[] = [];
      snap.forEach(doc => {
        const data = doc.data();
        if (data.seats_available > 0) {
          // Coarse bbox prefilter — skip rides clearly out of range before
          // the expensive per-coordinate haversine pass below.
          if (routeBboxIntersects(data.route_coords || [], pickup_lat, pickup_lng, drop_lat, drop_lng, max_detour_meters)) {
            rides.push({ id: doc.id, ...data });
          }
        }
      });

      const matchedResults: any[] = [];

      for (const ride of rides) {
        const driverDoc = await getDriverDoc(ride.driver_id);
        if (!driverDoc.exists) continue;
        const driver = driverDoc.data()!;

        const userDoc = await getUserDoc(driver.user_id);
        if (!userDoc.exists) continue;
        const user = userDoc.data()!;

        // Apply filters:
        if (gender_preference && gender_preference !== 'ANY' && user.gender !== gender_preference) {
          continue;
        }
        if (company_domain && user.company_domain !== company_domain) {
          continue;
        }
        if (society_name && user.society_name !== society_name) {
          continue;
        }
        if (ev_only && !driver.is_ev) {
          continue;
        }
        if (vehicle_type && vehicle_type !== 'ANY' && ride.vehicle_type !== vehicle_type) {
          continue;
        }
        if (music_allowed !== undefined && ride.music_allowed !== music_allowed) {
          continue;
        }
        if (smoking_allowed !== undefined && ride.smoking_allowed !== smoking_allowed) {
          continue;
        }
        if (chattiness && chattiness !== 'ANY' && ride.chattiness !== chattiness) {
          continue;
        }
        if (ac_available !== undefined && ride.ac_available !== ac_available) {
          continue;
        }

        // Perform spatial matching detour calculations
        const route_coords = ride.route_coords || [];
        if (route_coords.length === 0) continue;

        let minPickupDist = Infinity;
        let minDropDist = Infinity;
        let pickupIndex = -1;
        let dropIndex = -1;

        for (let i = 0; i < route_coords.length; i++) {
          const pt = route_coords[i];
          const distToPickup = haversineDistance(pickup_lat, pickup_lng, pt.lat, pt.lng);
          if (distToPickup < minPickupDist) {
            minPickupDist = distToPickup;
            pickupIndex = i;
          }
        }

        for (let i = 0; i < route_coords.length; i++) {
          const pt = route_coords[i];
          const distToDrop = haversineDistance(drop_lat, drop_lng, pt.lat, pt.lng);
          if (distToDrop < minDropDist) {
            minDropDist = distToDrop;
            dropIndex = i;
          }
        }

        // direction correctness check (pickupIndex < dropIndex) and detour constraint
        if (
          pickupIndex !== -1 && 
          dropIndex !== -1 && 
          pickupIndex < dropIndex && 
          minPickupDist <= max_detour_meters && 
          minDropDist <= max_detour_meters
        ) {
          matchedResults.push({
            id: ride.id,
            seats_available: ride.seats_available,
            price_split: ride.price_split,
            departure_time: ride.departure_time,
            vehicle_type: ride.vehicle_type,
            music_allowed: ride.music_allowed,
            smoking_allowed: ride.smoking_allowed,
            chattiness: ride.chattiness,
            ac_available: ride.ac_available,
            driver_name: user.name || 'Anonymous',
            driver_company: user.company_domain || null,
            driver_society: user.society_name || null,
            linkedin_profile_url: user.linkedin_profile_url || null,
            linkedin_connections: user.linkedin_connections || 0,
            is_ev: driver.is_ev || false,
            pickup_deviation: parseFloat(minPickupDist.toFixed(2)),
            drop_deviation: parseFloat(minDropDist.toFixed(2))
          });
        }
      }

      // Sort matches by combined detour distance deviation ascending, then cap.
      matchedResults.sort((a, b) => (a.pickup_deviation + a.drop_deviation) - (b.pickup_deviation + b.drop_deviation));
      const resultLimit = Number((body as any).limit) > 0 ? Number((body as any).limit) : DEFAULT_RESULT_LIMIT;
      const limitedResults = matchedResults.slice(0, resultLimit);

      // 2. Set Cache asynchronously (Expire in 60 seconds)
      if (redisClient.isOpen) {
        redisClient.setEx(cacheKey, 60, JSON.stringify(limitedResults)).catch(err => {
          fastify.log.error('Redis cache write failed:', err);
        });
      }

      return reply.send(limitedResults);
    } catch (err: any) {
      fastify.log.error('Spatial matching query failed:', err);
      return reply.code(500).send({ error: 'Failed to perform spatial routing match calculation.' });
    }
  });

  // 2b. List the authenticated driver's own rides (Partner/Fleet dashboard)
  fastify.get('/mine', { preHandler: [requireAuth] }, async (request, reply) => {
    const uid = request.user!.id;
    try {
      // Find driver profiles owned by this user (id may be stored as the raw
      // uid or prefixed forms), then collect their rides.
      const driverSnap = await db.collection('drivers').where('user_id', '==', String(uid)).get();
      const driverIds = driverSnap.docs.map(d => d.id);
      // Also match drivers stored with a user_ prefix variant.
      const altSnap = await db.collection('drivers').where('user_id', '==', `user_${uid}`).get();
      altSnap.docs.forEach(d => { if (!driverIds.includes(d.id)) driverIds.push(d.id); });

      if (driverIds.length === 0) {
        return reply.send([]);
      }

      const rides: any[] = [];
      // Firestore 'in' supports up to 30 values; chunk to be safe.
      for (let i = 0; i < driverIds.length; i += 30) {
        const chunk = driverIds.slice(i, i + 30);
        const snap = await db.collection('rides').where('driver_id', 'in', chunk).get();
        snap.forEach(doc => rides.push({ id: doc.id, ...doc.data() }));
      }

      rides.sort((a, b) => String(b.departure_time).localeCompare(String(a.departure_time)));
      return reply.send(rides);
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch driver rides');
      return reply.code(500).send({ error: 'Failed to fetch your rides.' });
    }
  });

  // 2c. Fetch a single ride's details (driver, vehicle, pickup) for the trip screen.
  fastify.get('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const rideDoc = await db.collection('rides').doc(String(id)).get();
      if (!rideDoc.exists) {
        return reply.code(404).send({ error: 'Ride not found.' });
      }
      const ride: any = { id: rideDoc.id, ...rideDoc.data() };
      // Enrich with the driver's display info when available.
      if (ride.driver_id) {
        const driverDoc = await db.collection('drivers').doc(String(ride.driver_id)).get();
        if (driverDoc.exists) {
          const d = driverDoc.data()!;
          ride.driver_name = ride.driver_name || d.name;
          ride.vehicle = ride.vehicle || d.vehicle_model || d.vehicle_type;
          ride.vehicle_plate = ride.vehicle_plate || d.vehicle_plate;
        }
      }
      return reply.send(ride);
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch ride');
      return reply.code(500).send({ error: 'Failed to fetch ride.' });
    }
  });

  // 3. Multi-modal / Transit Stitching Engine stub
  fastify.post('/search/stitch', { preHandler: [requireAuth] }, async (request, reply) => {
    const { pickup_lng, pickup_lat, drop_lng, drop_lat } = request.body as any;
    
    // Fallback: If no pure carpools match directly, stitch carpool to nearest metro station
    return reply.send({
      mode: 'STITCHED',
      leg1: {
        type: 'CARPOOL',
        to: 'IFFCO Chowk Metro Station',
        duration_mins: 12,
        cost: 45.00
      },
      leg2: {
        type: 'METRO',
        from: 'IFFCO Chowk',
        to: 'DLF Cyber City',
        duration_mins: 18,
        cost: 20.00
      }
    });
  });

  // 4. Create a recurring ride schedule (Quick Ride "Repeat Ride" Gap)
  fastify.post('/recurring', { preHandler: [requireAuth] }, async (request, reply) => {
    const { 
      driver_id, route_geojson, seats_total, price_split, 
      departure_time_of_day, days_of_week, vehicle_type = 'CAR'
    } = request.body as {
      driver_id: string | number;
      route_geojson: any;
      seats_total: number;
      price_split: number;
      departure_time_of_day: string;
      days_of_week: number[];
      vehicle_type?: 'CAR' | 'BIKE';
    };

    try {
      // Verify user is driver
      const driverDoc = await getDriverDoc(driver_id);
      if (!driverDoc.exists) {
        return reply.code(404).send({ error: 'Driver profile not found.' });
      }
      const driverData = driverDoc.data()!;
      if (String(driverData.user_id) !== String(request.user?.id) && String(driverData.user_id) !== `user_${request.user?.id}`) {
        return reply.code(403).send({ error: 'Forbidden: You do not own this driver profile.' });
      }

      let routeCoords: { lat: number; lng: number }[] = [];
      if (route_geojson) {
        try {
          const geojson = typeof route_geojson === 'string' ? JSON.parse(route_geojson) : route_geojson;
          if (geojson && geojson.type === 'LineString' && Array.isArray(geojson.coordinates)) {
            routeCoords = geojson.coordinates.map((coord: any) => ({
              lat: coord[1],
              lng: coord[0]
            }));
          }
        } catch (err: any) {
          fastify.log.error(err, 'Failed to parse route_geojson');
        }
      }

      const id = 'recurring_' + randomUUID();
      const newRecurringRide = {
        id,
        driver_id: String(driver_id),
        route_coords: routeCoords,
        seats_total: Number(seats_total),
        price_split: Number(price_split),
        departure_time_of_day,
        days_of_week,
        vehicle_type,
        created_at: new Date().toISOString()
      };

      await db.collection('recurring_rides').doc(id).set(newRecurringRide);
      return reply.code(201).send(newRecurringRide);
    } catch (err: any) {
      fastify.log.error('Failed to create recurring ride:', err);
      return reply.code(500).send({ error: 'Database failure to register recurring ride.' });
    }
  });

  // 5. Get recurring rides
  fastify.get('/recurring', { preHandler: [requireAuth] }, async (request, reply) => {
    const { driver_id } = request.query as { driver_id?: string };

    try {
      let queryRef: any = db.collection('recurring_rides');

      if (driver_id) {
        queryRef = queryRef.where('driver_id', '==', String(driver_id));
      }

      const snap = await queryRef.get();
      const results: any[] = [];
      snap.forEach((doc: any) => {
        results.push({
          id: doc.id,
          ...doc.data()
        });
      });
      return reply.send(results);
    } catch (err: any) {
      fastify.log.error('Failed to fetch recurring rides:', err);
      return reply.code(500).send({ error: 'Failed to fetch recurring rides.' });
    }
  });

  // ── PATCH /:id/status — driver moves ride through lifecycle ──────────────
  // Valid transitions: SCHEDULED → STARTED → COMPLETED | CANCELLED
  // On COMPLETED, all HELD escrow bookings are auto-settled to the driver.
  fastify.patch('/:id/status', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };
    const uid = String(request.user!.id);

    const VALID = ['STARTED', 'COMPLETED', 'CANCELLED'];
    if (!VALID.includes(status)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
    }

    try {
      const rideRef = db.collection('rides').doc(id);
      const rideDoc = await rideRef.get();
      if (!rideDoc.exists) return reply.code(404).send({ error: 'Ride not found.' });

      const ride = rideDoc.data()!;
      // Only the driver who owns this ride may update its status
      if (String(ride.driver_uid ?? ride.driver_id) !== uid) {
        return reply.code(403).send({ error: 'Forbidden: only the ride driver can update status.' });
      }

      await rideRef.update({ status, updated_at: new Date().toISOString() });

      // On completion, auto-settle all HELD escrow bookings for this ride
      if (status === 'COMPLETED') {
        const bookingsSnap = await db.collection('bookings')
          .where('ride_id', '==', id)
          .where('escrow_status', '==', 'HELD')
          .get();

        const batch = db.batch();
        bookingsSnap.docs.forEach((doc) => {
          batch.update(doc.ref, {
            escrow_status: 'SETTLED',
            payment_status: 'RELEASED',
            settled_at: new Date().toISOString(),
          });
        });
        if (!bookingsSnap.empty) await batch.commit();

        fastify.log.info({ ride_id: id, settled: bookingsSnap.size }, 'Auto-settled escrow on ride completion');
      }

      return reply.send({ id, status, updated: true });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to update ride status');
      return reply.code(500).send({ error: 'Failed to update ride status.' });
    }
  });
}
