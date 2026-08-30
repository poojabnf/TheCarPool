import { FastifyInstance } from 'fastify';
import { defaultCurrency } from '../lib/config';
import { randomUUID } from 'crypto';
import { db, redisClient } from '../server';
import { requireAuth, requireAdmin, requireCronOrAdmin } from '../middleware/auth';
import { canTransition, isSettableStatus, SETTABLE_STATUSES } from '../lib/rideLifecycle';
import { noShowOutcome } from '../lib/fees';
import { planPayout, maskPayoutMethod } from '../lib/payouts';
import { classifyVehicle, listMakes, listModels, VEHICLE_CLASSES } from '../lib/vehicles';
import { needsDepartureReminder, minutesUntil } from '../lib/rideNotifications';
import { needsBoardingReminder, minutesUntil as etaMinutesUntil, BOARDING_REMINDER_MINUTES } from '../lib/eta';
import {
  notifyBoardingSoon, resolveStopEtasForRide, notifyRideCompleted,
  notifyRideStarted, notifyDriverCancelledRide, notifyRideOffered,
} from '../lib/bookingNotifications';
import { settlementDueAt, DISPUTE_WINDOW_MINUTES } from '../lib/settlement';
import { settleDueBookingsForRide } from '../lib/rideSettlement';
import { sendPushToUser } from '../lib/fcm';
import { getUserEmail, buildRideOfferedEmail, sendEmail } from '../lib/email';
import { round2 } from '../lib/money';
import { refundPaymentToSource } from '../lib/razorpay';
import { reverseTransfer } from '../lib/route';
import { isInServiceBounds, outOfAreaMessage } from '../lib/serviceArea';
import { normaliseStopPrice, validateStopPrices } from '../lib/stopPricing';
import { findMetroByCoords, findMetroByText, coordInMetroBbox, type MetroRegion } from '../lib/metroRegions';

/** Uids of riders with a live booking on a ride — who gets told about it. */
async function activeRiderUids(rideId: string): Promise<string[]> {
  const snap = await db.collection('bookings').where('ride_id', '==', rideId).get();
  return [...new Set(
    snap.docs
      .filter((d) => {
        const b = d.data();
        return b.status !== 'CANCELLED' && !['CANCELLED', 'REFUNDED'].includes(String(b.escrow_status));
      })
      .map((d) => String(d.data().rider_id))
  )];
}


/** Hard cap on driver-declared pickup points; keeps ride docs and rider UI sane. */
const MAX_PICKUP_POINTS = 10;

/**
 * Validate and normalise the driver's extra pickup points.
 *
 * Anything without usable coordinates is dropped rather than stored as NaN —
 * a bad point would otherwise render as a pin at (0,0) off the coast of Africa
 * and could be booked against.
 */
function normalisePickupPoints(
  raw: unknown
): { label: string | null; lat: number; lng: number; eta: string | null; price: number | null }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string | null; lat: number; lng: number; eta: string | null; price: number | null }[] = [];
  for (const p of raw) {
    const lat = Number((p as any)?.lat);
    const lng = Number((p as any)?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (lat === 0 && lng === 0) continue;
    // Optional arrival time the driver committed to for this stop. Stored as
    // an ISO string; anything unparseable is dropped rather than kept as junk,
    // and the stop then falls back to a computed estimate.
    const rawEta = (p as any)?.eta ?? (p as any)?.driver_eta ?? null;
    const parsed = Date.parse(String(rawEta ?? ''));
    const eta = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    // Optional per-seat fare for boarding HERE rather than at the origin. Null
    // means no separate price, and the rider pays the full ride fare — which
    // is what every ride did before stop pricing existed.
    const price = normaliseStopPrice((p as any)?.price);
    out.push({ label: clean((p as any)?.label), lat, lng, eta, price });
    if (out.length >= MAX_PICKUP_POINTS) break;
  }
  return out;
}

/**
 * Normalise a free-text vehicle/label field. Trimmed, length-capped so it can't
 * be used to smuggle a paragraph into a rider-facing card, and null when empty
 * so the UI can fall back cleanly rather than rendering "".
 */
function clean(v: unknown, upper = false): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!t) return null;
  return upper ? t.toUpperCase() : t;
}

/**
 * Same normalisation as clean(), with room for a real address.
 *
 * clean()'s 40-character cap suits a vehicle make or colour but truncates a
 * place name mid-word ("DLF Cyber City Building 10, Guru…"), so endpoints get
 * their own limit.
 */
function cleanPlace(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ').slice(0, 120);
  return t || null;
}

interface CreateRideBody {
  driver_id: string | number;
  route_geojson: any; // GeoJSON LineString representing route
  /**
   * Human-readable endpoints, exactly as the driver picked them.
   *
   * The route was previously stored only as coordinates, so nothing in the app
   * could name where a ride actually went — the home screen fell back to the
   * literal words "Pickup → Destination" and the driver's own card showed a
   * truncated ride id. Coordinates stay authoritative for matching; these are
   * for display.
   */
  source?: string;
  destination?: string;
  seats_total: number;
  price_split: number;
  departure_time: string;
  vehicle_type?: 'CAR' | 'BIKE';
  // Optional extra stops the driver is willing to pick up from, so riders who
  // aren't at the single origin still have somewhere to meet.
  pickup_points?: { label?: string; lat: number; lng: number }[];
  /**
   * Route length in km, derived by the app from source/destination.
   * Prices the optional journey insurance — without it insurancePremium() sees
   * 0 and the insurance option silently never appears to riders.
   */
  distance_km?: number;
  // Shown to riders before they book so they know what they're getting into.
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_colour?: string;
  vehicle_plate?: string;
  music_allowed?: boolean;
  smoking_allowed?: boolean;
  chattiness?: 'QUIET' | 'MEDIUM' | 'TALKATIVE';
  ac_available?: boolean;
  women_only?: boolean;
  // Later-phase modes: daily commute (default), BlaBlaCar-style intercity,
  // or event/festival carpooling with a shared tag riders search by.
  ride_type?: 'COMMUTE' | 'INTERCITY' | 'EVENT';
  event_tag?: string;
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
  women_only?: boolean; // women-safety mode: women-only rides or women drivers
  ride_type?: 'COMMUTE' | 'INTERCITY' | 'EVENT' | 'ANY';
  event_tag?: string;
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

// Trust level from real ride/rating history: Gold (25+ rated trips, 4.5+),
// Silver (10+, 4.0+), Bronze (1+ rated trip), New otherwise.
function trustLevel(ratingCount: number, ratingAvg: number): 'GOLD' | 'SILVER' | 'BRONZE' | 'NEW' {
  if (ratingCount >= 25 && ratingAvg >= 4.5) return 'GOLD';
  if (ratingCount >= 10 && ratingAvg >= 4.0) return 'SILVER';
  if (ratingCount >= 1) return 'BRONZE';
  return 'NEW';
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

/**
 * How far a metro-area match may be from the rider (expanded to 100km coverage).
 *
 * Covers long-distance inter-city and whole-region commutes across NCR (Delhi ↔ Gurugram ↔ Noida ↔ Greater Noida ↔ Faridabad ↔ Meerut),
 * Mumbai MMR, Bengaluru, Pune, and other large metro belts.
 */
const METRO_DETOUR_METERS = 100_000; // 100 KM
const DEFAULT_RESULT_LIMIT = 50;

/**
 * How far a rider may be from one of the driver's DECLARED pickup stops and
 * still see the ride (expanded to 100km).
 */
const PICKUP_POINT_RADIUS_METERS = 100_000; // 100 KM

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

  // ── POST /notify-upcoming — one-hour departure reminders ─────────────────
  // Intended for a scheduler (every ~5 min comfortably covers the window).
  // Idempotent: a ride is flagged once reminded, so a double-run cannot spam.
  fastify.post('/notify-upcoming', { preHandler: [requireCronOrAdmin] }, async (_request, reply) => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 65 * 60 * 1000).toISOString();

    const snap = await db.collection('rides')
      .where('status', '==', 'SCHEDULED')
      .where('departure_time', '>', now.toISOString())
      .where('departure_time', '<', horizon)
      .limit(200)
      .get();

    let notified = 0;
    for (const doc of snap.docs) {
      const ride = doc.data();
      if (!needsDepartureReminder(ride, now)) continue;

      // Claim it before sending so two overlapping sweeps can't both notify.
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (fresh.data()?.departure_reminder_sent === true) return false;
        tx.update(doc.ref, { departure_reminder_sent: true });
        return true;
      }).catch(() => false);
      if (!claimed) continue;

      const mins = minutesUntil(String(ride.departure_time), now);
      const riders = await activeRiderUids(doc.id);
      for (const rider of riders) {
        sendPushToUser(rider, `⏰ Your ride leaves in ${mins} minutes`,
          'Be ready at your pickup point. Your boarding code is on the trip screen.',
          { type: 'RIDE_REMINDER', ride_id: doc.id });
      }
      if (riders.length) notified += 1;
    }

    return reply.send({ scanned: snap.size, rides_notified: notified });
  });

  // ── POST /notify-boarding — "be ready" nudge, ~30 min before pickup ──────
  // Separate from the departure reminder above, and deliberately per-RIDER:
  // it fires 30 minutes before the driver reaches THAT rider's stop, not 30
  // minutes before the ride departs. Telling someone at the last stop to be
  // ready when the driver is still an hour away is worse than saying nothing.
  //
  // Idempotent per booking, so overlapping sweeps cannot double-notify.
  fastify.post('/notify-boarding', { preHandler: [requireCronOrAdmin] }, async (_request, reply) => {
    const now = new Date();
    // Wide enough to cover late stops on a long route, since a stop's ETA can
    // sit well after the ride's departure time.
    const horizon = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

    const snap = await db.collection('rides')
      .where('status', '==', 'SCHEDULED')
      .where('departure_time', '>', new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString())
      .where('departure_time', '<', horizon)
      .limit(200)
      .get();

    let notified = 0;
    for (const rideDoc of snap.docs) {
      const ride = rideDoc.data();
      const stops = Array.isArray(ride.pickup_points) ? ride.pickup_points : [];

      // Resolve each stop's arrival once per ride — cached in lib/eta, so a
      // ride with many riders still costs a single Directions lookup.
      let stopEtas: Awaited<ReturnType<typeof resolveStopEtasForRide>> = [];
      try {
        stopEtas = await resolveStopEtasForRide(ride, stops);
      } catch { /* fall through: riders without an ETA are simply skipped */ }

      const bookingsSnap = await db.collection('bookings')
        .where('ride_id', '==', rideDoc.id)
        .where('escrow_status', '==', 'HELD')
        .get();

      for (const bookingDoc of bookingsSnap.docs) {
        const booking = bookingDoc.data();
        if (String(booking.booking_status ?? 'CONFIRMED') !== 'CONFIRMED') continue;
        if (booking.boarding_reminder_sent === true) continue;

        // Which stop is this rider boarding at? Fall back to the ride's
        // departure when they are not on a declared stop.
        const pickup = booking.pickup_point ?? {};
        const match = stopEtas.find((s) =>
          typeof pickup.lat === 'number' && typeof pickup.lng === 'number' &&
          Math.abs(s.lat - pickup.lat) < 0.001 && Math.abs(s.lng - pickup.lng) < 0.001
        );
        const eta = match?.eta ?? ride.departure_time ?? null;
        if (!needsBoardingReminder(eta, false, now)) continue;

        const claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(bookingDoc.ref);
          if (fresh.data()?.boarding_reminder_sent === true) return false;
          tx.update(bookingDoc.ref, { boarding_reminder_sent: true });
          return true;
        }).catch(() => false);
        if (!claimed) continue;

        const mins = etaMinutesUntil(eta, now) ?? BOARDING_REMINDER_MINUTES;
        notifyBoardingSoon(
          { rideId: rideDoc.id, riderUid: String(booking.rider_id ?? booking.rider_uid) },
          { ...booking, id: bookingDoc.id, pickup_label: match?.label ?? null },
          mins,
          fastify.log
        );
        notified += 1;
      }
    }

    return reply.send({ scanned: snap.size, riders_notified: notified });
  });

  // ── POST /settle-due — pay out rides whose hold has matured ──────────────
  // The other half of deferred settlement. Completion only starts the clock;
  // this is what actually moves money, once the hold has elapsed and nobody
  // has disputed. Must be scheduled (Cloud Scheduler) — without something
  // calling it, drivers are never paid at all.
  //
  // Idempotent: settled bookings leave HELD, and isSettlementDue is re-checked
  // inside the transaction, so overlapping runs cannot double-pay.
  fastify.post('/settle-due', { preHandler: [requireCronOrAdmin] }, async (_request, reply) => {
    const now = new Date();
    const snap = await db.collection('rides')
      .where('status', '==', 'COMPLETED')
      .where('settlement_due_at', '<', now.toISOString())
      .limit(100)
      .get();

    let ridesSettled = 0;
    const totals = { paid: 0, no_shows: 0, driver_credited: 0, skipped: 0 };

    for (const doc of snap.docs) {
      const ride = doc.data();
      if (ride.escrow_settled === true) continue;
      const driverUid = String(ride.driver_uid ?? ride.driver_id ?? '');
      if (!driverUid) continue;

      const outcome = await settleDueBookingsForRide(doc.id, driverUid, fastify.log);
      totals.paid += outcome.paid;
      totals.no_shows += outcome.no_shows;
      totals.driver_credited = round2(totals.driver_credited + outcome.driver_credited);
      totals.skipped += outcome.skipped;
      if (outcome.paid > 0 || outcome.no_shows > 0) ridesSettled += 1;
    }

    return reply.send({ scanned: snap.size, rides_settled: ridesSettled, ...totals });
  });

  /**
   * ── POST /cleanup-expired ────────────────────────────────────────────────
   * Automatically expires and cancels stale rides posted > 5 days ago or whose
   * departure date has passed with no activity.
   */
  fastify.post('/cleanup-expired', { preHandler: [requireCronOrAdmin] }, async (_request, reply) => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    
    // Find scheduled rides created more than 5 days ago
    const staleSnap = await db.collection('rides')
      .where('status', 'in', ['SCHEDULED', 'CREATED'])
      .where('created_at', '<=', fiveDaysAgo)
      .limit(100)
      .get();

    let cleaned = 0;
    const batch = db.batch();

    for (const doc of staleSnap.docs) {
      batch.update(doc.ref, {
        status: 'CANCELLED',
        cancellation_reason: 'EXPIRED_AUTO_CLEANUP_5_DAYS',
        updated_at: new Date().toISOString(),
      });
      cleaned += 1;
    }

    if (cleaned > 0) {
      await batch.commit();
    }

    return reply.send({
      scanned: staleSnap.size,
      cleaned,
      cutoff_date: fiveDaysAgo,
    });
  });

  // ── GET /vehicle-catalogue — makes, models and size classes ──────────────
  // One source of truth for the driver's pickers and the rider's icons, so the
  // two can't disagree about what a "Creta" is.
  fastify.get('/vehicle-catalogue', async (_request, reply) => {
    return reply.send({
      makes: listMakes().map((m) => ({
        ...m,
        models: listModels(m.key),
      })),
      classes: VEHICLE_CLASSES,
    });
  });

  
  // 1. Create a ride with LineString geometry
  fastify.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const {
      driver_id, route_geojson, seats_total, price_split, departure_time,
      vehicle_type = 'CAR', music_allowed = true, smoking_allowed = false,
      chattiness = 'MEDIUM', ac_available = true, women_only = false,
      ride_type = 'COMMUTE', event_tag,
      vehicle_make, vehicle_model, vehicle_colour, vehicle_plate,
      pickup_points, distance_km, source, destination
    } = request.body as CreateRideBody;

    if (!['COMMUTE', 'INTERCITY', 'EVENT'].includes(ride_type)) {
      return reply.code(400).send({ error: 'ride_type must be COMMUTE, INTERCITY or EVENT.' });
    }
    if (ride_type === 'EVENT' && !(event_tag && String(event_tag).trim().length >= 2)) {
      return reply.code(400).send({ error: 'EVENT rides need an event_tag (e.g. "sunburn-2026").' });
    }

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

    // Stop fares are checked against the full-journey fare here rather than
    // clamped, because the driver is present and can correct it. Quietly
    // rewriting someone's price is how they end up carrying riders for a fare
    // they never agreed to.
    {
      const check = validateStopPrices(pickup_points, Number(price_split));
      if (!check.valid) {
        return reply.code(400).send({ error: 'INVALID_STOP_FARE', message: check.reason });
      }
    }

    // Both endpoints must be inside the service area. The app restricts what
    // can be picked, but the app is not the authority: an older build, or a
    // direct API call, could otherwise post a Jhansi-to-Manhattan ride that
    // nothing downstream can price, insure or settle.
    {
      const pts = Array.isArray(route_geojson?.coordinates) ? route_geojson.coordinates : [];
      const outside = pts.find(
        (c: any) => Array.isArray(c) && !isInServiceBounds(Number(c[1]), Number(c[0]))
      );
      if (outside) {
        return reply.code(400).send({
          error: 'OUT_OF_SERVICE_AREA',
          message: outOfAreaMessage(),
        });
      }
    }

    try {
      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.data();

      // Women-only rides can only be offered by female drivers.
      if (women_only && userData?.gender !== 'FEMALE') {
        return reply.code(403).send({
          error: 'WOMEN_ONLY_DRIVER_REQUIRED',
          message: 'Only female drivers can offer women-only rides.',
        });
      }

      // Resolve the caller's driver profile, auto-provisioning one on first
      // offer. We never provision a profile for a different user's id.
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
        // Display names for the two endpoints. Trimmed and length-capped: they
        // are rendered straight into rider-facing lists and notifications.
        source: cleanPlace(source),
        destination: cleanPlace(destination),
        seats_total: Number(seats_total),
        seats_available: Number(seats_total),
        price_split: Number(price_split),
        departure_time,
        vehicle_type,
        distance_km: Number.isFinite(Number(distance_km)) && Number(distance_km) > 0
          ? Math.round(Number(distance_km) * 10) / 10
          : null,
        pickup_points: normalisePickupPoints(pickup_points),
        // Defaults to TRUE: every ride requires the driver to approve/accept each rider.
        // If explicitly set to false by the driver, it confirms instantly.
        requires_approval: (request.body as any)?.requires_approval !== false,
        vehicle_make: clean(vehicle_make),
        // Derived server-side, never taken from the client: a ride could
        // otherwise claim SUV for a two-seater and mislead riders at booking.
        vehicle_class: classifyVehicle(vehicle_make, vehicle_model, vehicle_type),
        vehicle_model: clean(vehicle_model),
        vehicle_colour: clean(vehicle_colour),
        vehicle_plate: clean(vehicle_plate, true),
        music_allowed,
        smoking_allowed,
        chattiness,
        ac_available,
        women_only: Boolean(women_only),
        ride_type,
        event_tag: ride_type === 'EVENT' ? String(event_tag).trim().toLowerCase() : null,
        status: 'SCHEDULED',
        created_at: new Date().toISOString()
      };

      await db.collection('rides').doc(rideId).set(newRide);

      // Async email notification — does not block API response
      (async () => {
        try {
          const userContact = await getUserEmail(uid);
          if (userContact?.email) {
            const emailData = buildRideOfferedEmail({
              driverName: userContact.name,
              rideId,
              seatsTotal: Number(seats_total),
              pricePerSeat: Number(price_split),
              departureTime: departure_time,
              vehicle: {
                make: vehicle_make,
                model: vehicle_model,
                plate: vehicle_plate,
                type: vehicle_type,
              },
              pickupPoints: newRide.pickup_points || [],
              distanceKm: newRide.distance_km,
            });
            await sendEmail({
              to: userContact.email,
              subject: emailData.subject,
              html: emailData.html,
              text: emailData.text,
            });
          }
        } catch (emailErr) {
          fastify.log.error(emailErr, 'Failed to send ride offer confirmation email');
        }

        // Push confirmation to driver
        notifyRideOffered(rideId, uid, newRide, fastify.log).catch(() => { /* best-effort */ });
      })();

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
      vehicle_type = 'ANY', music_allowed, smoking_allowed, chattiness = 'ANY', ac_available,
      women_only = false, ride_type = 'ANY', event_tag,
      // Departure window. Riders search for a commute at a time — without
      // this, a ride leaving in 20 minutes and one leaving in three weeks
      // came back intermixed, ordered only by driver detour.
      departure_from, departure_to,
    } = body as SearchRideBody & { departure_from?: string; departure_to?: string };

    // Searcher's gender gates women-only rides both ways: the women-safety
    // toggle requires it, and women-only rides are hidden from other users.
    const searcherDoc = await db.collection('users').doc(String(request.user!.id)).get();
    const searcherGender = searcherDoc.data()?.gender;
    if (women_only && searcherGender !== 'FEMALE') {
      return reply.code(403).send({
        error: 'WOMEN_ONLY_MODE_RESTRICTED',
        message: 'Women-safety mode is available to female riders. Set your gender in your profile.',
      });
    }

    // Validate bounds
    if (pickup_lat > 90 || pickup_lat < -90 || drop_lat > 90 || drop_lat < -90 || pickup_lng > 180 || pickup_lng < -180 || drop_lng > 180 || drop_lng < -180) {
      return reply.code(400).send({ error: 'Invalid coordinates' });
    }

    // Build Cache Key securely.
    //
    // Every input that changes the RESULT must appear here. The departure
    // window was missing while the query filtered on it, so a search for
    // "tomorrow morning" served the cached answer to "next 2 hours" from the
    // same pickup and drop — rides for the wrong day, presented as matches.
    // Anything added to the filter above must be added here too.
    const cacheKey = `search:${pickup_lng},${pickup_lat},${drop_lng},${drop_lat},${max_detour_meters},${gender_preference || 'ANY'},${company_domain || 'NONE'},${society_name || 'NONE'},${ev_only},${vehicle_type},${music_allowed ?? 'ANY'},${smoking_allowed ?? 'ANY'},${chattiness},${ac_available ?? 'ANY'},${women_only},${searcherGender || 'UNKNOWN'},${ride_type},${event_tag || 'NONE'},${departure_from || 'ANY'},${departure_to || 'ANY'},${request.user!.id}`;
    
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
      // Never return departed rides: honour departure_from only when it is in
      // the future, so a stale or hand-crafted value can't surface past rides.
      const lowerBound = departure_from && departure_from > now ? departure_from : now;
      let ridesQuery = db.collection('rides')
        .where('status', '==', 'SCHEDULED')
        .where('departure_time', '>', lowerBound);
      if (departure_to) {
        ridesQuery = ridesQuery.where('departure_time', '<', departure_to);
      }
      const snap = await ridesQuery
        .orderBy('departure_time', 'asc')
        .limit(MAX_RIDE_SCAN)
        .get();

      // ── Metro-area resolution ─────────────────────────────────────────
      // If the rider's pickup or drop is inside a known metro (e.g. Delhi
      // NCR), rides from sibling cities (Noida, Gurugram, Ghaziabad) are
      // also surfaced even when the strict 1.5 km coordinate match fails.
      const pickupMetro = findMetroByCoords(pickup_lat, pickup_lng);
      const dropMetro = findMetroByCoords(drop_lat, drop_lng);

      const rides: any[] = [];
      const metroMatchedIds = new Set<string>();

      snap.forEach(doc => {
        const data = doc.data();
        if (data.seats_available <= 0) return;

        // 1. Standard coordinate bbox prefilter (or wide-radius 100km route check)
        const nearRoute = routeBboxIntersects(
          data.route_coords || [], pickup_lat, pickup_lng, drop_lat, drop_lng, METRO_DETOUR_METERS
        );
        const nearDeclaredStop = !nearRoute && (data.pickup_points || []).some((stop: any) =>
          typeof stop?.lat === 'number' && typeof stop?.lng === 'number' &&
          haversineDistance(pickup_lat, pickup_lng, stop.lat, stop.lng) <= PICKUP_POINT_RADIUS_METERS
        );

        if (nearRoute || nearDeclaredStop) {
          rides.push({ id: doc.id, ...data, _metroMatch: true });
          return;
        }

        // 2. Metro-area text match: does the ride's source or destination
        //    mention a city in the same metro as the searcher?
        if (pickupMetro || dropMetro) {
          const rideSourceMetro = findMetroByText(data.source);
          const rideDestMetro = findMetroByText(data.destination);

          const pickupSameMetro = pickupMetro && rideSourceMetro && pickupMetro.name === rideSourceMetro.name;
          const dropSameMetro = dropMetro && rideDestMetro && dropMetro.name === rideDestMetro.name;
          // Also match if the ride's route passes through the searcher's metro bbox
          const routeInPickupMetro = pickupMetro && (data.route_coords || []).some(
            (pt: any) => coordInMetroBbox(pt.lat, pt.lng, pickupMetro!)
          );
          const routeInDropMetro = dropMetro && (data.route_coords || []).some(
            (pt: any) => coordInMetroBbox(pt.lat, pt.lng, dropMetro!)
          );

          if ((pickupSameMetro || routeInPickupMetro) || (dropSameMetro || routeInDropMetro)) {
            rides.push({ id: doc.id, ...data, _metroMatch: true });
            metroMatchedIds.add(doc.id);
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
        // Never offer someone their own ride. It was bookable: the driver
        // could pay themselves, hold their own seat and sit in their own
        // approval queue. Checked against driver_uid, falling back to the
        // driver profile's user_id for rides posted before that was stored.
        const rideDriverUid = String(ride.driver_uid ?? driver.user_id ?? '');
        if (rideDriverUid && rideDriverUid === String(request.user!.id)) {
          continue;
        }
        // Women-only rides are visible only to female searchers.
        if (ride.women_only && searcherGender !== 'FEMALE') {
          continue;
        }
        // Women-safety mode: only women-only rides or rides driven by women.
        if (women_only && !(ride.women_only || user.gender === 'FEMALE')) {
          continue;
        }
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
        // Ride-type filter: legacy rides without the field count as COMMUTE.
        const effectiveType = ride.ride_type || 'COMMUTE';
        if (ride_type && ride_type !== 'ANY' && effectiveType !== ride_type) {
          continue;
        }
        if (event_tag && ride.event_tag !== String(event_tag).trim().toLowerCase()) {
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

        // The driver's declared stops are a promise to collect there, so a rider
        // near one matches even when the polyline itself stays far away. Only
        // considered when it beats the route distance, so a rider standing on
        // the route is still reported against the route.
        // Metro-matched rides are, by definition, further away than the strict
        // radius — that is the whole point of surfacing them. Without widening
        // the allowance here they were collected above and then dropped by this
        // same gate, so the metro layer found candidates and discarded every
        // one of them. Only rides already flagged _metroMatch get the wider
        // tolerance; nearby matching stays at max_detour_meters.
        let pickupAllowance = ride._metroMatch ? METRO_DETOUR_METERS : max_detour_meters;
        const dropAllowance = ride._metroMatch ? METRO_DETOUR_METERS : max_detour_meters;
        let viaPickupPoint: string | null = null;
        for (const stop of (ride.pickup_points || [])) {
          if (typeof stop?.lat !== 'number' || typeof stop?.lng !== 'number') continue;
          const distToStop = haversineDistance(pickup_lat, pickup_lng, stop.lat, stop.lng);
          if (distToStop > PICKUP_POINT_RADIUS_METERS || distToStop >= minPickupDist) continue;

          // Anchor the stop to the route so the pickup-before-drop ordering
          // below still means something.
          let stopIndex = -1;
          let stopToRoute = Infinity;
          for (let i = 0; i < route_coords.length; i++) {
            const rd = haversineDistance(stop.lat, stop.lng, route_coords[i].lat, route_coords[i].lng);
            if (rd < stopToRoute) { stopToRoute = rd; stopIndex = i; }
          }
          if (stopIndex === -1) continue;

          minPickupDist = distToStop;
          pickupIndex = stopIndex;
          pickupAllowance = PICKUP_POINT_RADIUS_METERS;
          viaPickupPoint = stop.label || 'Driver stop';
        }

        // direction correctness check (pickupIndex < dropIndex) and detour constraint
        if (
          pickupIndex !== -1 &&
          dropIndex !== -1 &&
          pickupIndex < dropIndex &&
          minPickupDist <= pickupAllowance &&
          minDropDist <= dropAllowance
        ) {
          matchedResults.push({
            id: ride.id,
            // Where the ride actually starts and ends. Riders were choosing
            // between results — and paying — with no route shown at all.
            source: ride.source ?? null,
            destination: ride.destination ?? null,
            seats_available: ride.seats_available,
            price_split: ride.price_split,
            departure_time: ride.departure_time,
            vehicle_type: ride.vehicle_type,
            pickup_points: ride.pickup_points ?? [],
            distance_km: ride.distance_km ?? null,
            vehicle_make: ride.vehicle_make ?? null,
            vehicle_class: ride.vehicle_class ?? classifyVehicle(ride.vehicle_make, ride.vehicle_model, ride.vehicle_type),
            vehicle_model: ride.vehicle_model ?? null,
            vehicle_colour: ride.vehicle_colour ?? null,
            vehicle_plate: ride.vehicle_plate ?? null,
            music_allowed: ride.music_allowed,
            smoking_allowed: ride.smoking_allowed,
            chattiness: ride.chattiness,
            ac_available: ride.ac_available,
            women_only: ride.women_only || false,
            ride_type: ride.ride_type || 'COMMUTE',
            event_tag: ride.event_tag || null,
            driver_name: user.name || 'Anonymous',
            driver_company: user.company_domain || null,
            driver_society: user.society_name || null,
            linkedin_profile_url: user.linkedin_profile_url || null,
            linkedin_connections: user.linkedin_connections || 0,
            is_ev: driver.is_ev || false,
            // Real reputation data — drives rating display + trust badges.
            driver_rating: user.rating_avg ? parseFloat(user.rating_avg.toFixed(2)) : null,
            driver_rating_count: user.rating_count || 0,
            driver_trust_level: trustLevel(user.rating_count || 0, user.rating_avg || 0),
            // Lets the app badge a wide-area result rather than presenting a
            // 20 km pickup as though it were around the corner.
            metro_match: ride._metroMatch === true,
            metro_region: ride._metroMatch ? (findMetroByCoords(pickup_lat, pickup_lng)?.name ?? null) : null,
            pickup_deviation: parseFloat(minPickupDist.toFixed(2)),
            // Names the driver stop that made this a match, so the rider can be
            // told where to go rather than just how far away it is.
            via_pickup_point: viaPickupPoint,
            drop_deviation: parseFloat(minDropDist.toFixed(2)),
            created_at: ride.created_at || null,
          });
        }
      }

      // Ratings-weighted matching: rank by detour distance, discounted by the
      // driver's earned trust. A GOLD driver effectively "beats" an unrated one
      // at up to 400m extra deviation — new users see high-trust matches first
      // without high-detour rides jumping the queue entirely.
      const TRUST_BONUS_METERS: Record<string, number> = { GOLD: 400, SILVER: 200, BRONZE: 75, NEW: 0 };
      const matchScore = (r: any) =>
        r.pickup_deviation + r.drop_deviation
        - (TRUST_BONUS_METERS[r.driver_trust_level] || 0);
      // Exact coordinate matches always rank above metro-area ones, however
      // small the metro ride's detour looks — a rider wants the car passing
      // their street before one across the city.
      matchedResults.sort((a, b) => {
        if (a.metro_match !== b.metro_match) return a.metro_match ? 1 : -1;
        return matchScore(a) - matchScore(b);
      });
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
    const uid = String(request.user!.id);
    try {
      const ridesMap = new Map<string, any>();

      // 1. Direct query by driver_uid (covers all standard ride creation)
      const directUidSnap = await db.collection('rides').where('driver_uid', '==', uid).get();
      directUidSnap.forEach((doc) => ridesMap.set(doc.id, { id: doc.id, ...doc.data() }));

      // 2. Direct query by driver_id == uid
      const directDriverIdSnap = await db.collection('rides').where('driver_id', '==', uid).get();
      directDriverIdSnap.forEach((doc) => ridesMap.set(doc.id, { id: doc.id, ...doc.data() }));

      // 3. Find driver profiles owned by this user
      const driverSnap = await db.collection('drivers').where('user_id', '==', uid).get();
      const driverIds = driverSnap.docs.map(d => d.id);
      const altSnap = await db.collection('drivers').where('user_id', '==', `user_${uid}`).get();
      altSnap.docs.forEach(d => { if (!driverIds.includes(d.id)) driverIds.push(d.id); });

      // 4. Query rides by associated driver profile IDs
      const remainingDriverIds = driverIds.filter((id) => id !== uid);
      for (let i = 0; i < remainingDriverIds.length; i += 30) {
        const chunk = remainingDriverIds.slice(i, i + 30);
        const snap = await db.collection('rides').where('driver_id', 'in', chunk).get();
        snap.forEach((doc) => ridesMap.set(doc.id, { id: doc.id, ...doc.data() }));
      }

      const rides = Array.from(ridesMap.values());
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
      const callerId = String(request.user?.id || '');
      const isDriver = callerId === String(ride.driver_uid || ride.driver_id);
      let isConfirmedPassenger = false;

      if (!isDriver && callerId) {
        const userBookingSnap = await db.collection('bookings')
          .where('ride_id', '==', String(id))
          .where('rider_id', '==', callerId)
          .get();
        isConfirmedPassenger = userBookingSnap.docs.some((d) => {
          const b = d.data();
          return b.booking_status === 'CONFIRMED' || b.escrow_status === 'HELD' || b.escrow_status === 'SETTLED';
        });
      }

      const hasDirectAccess = isDriver || isConfirmedPassenger || request.user?.role === 'ADMIN';

      // Enrich with the driver's display & contact info
      if (ride.driver_uid || ride.driver_id) {
        const driverUid = ride.driver_uid || (ride.driver_id.startsWith('driver_') ? ride.driver_id.replace('driver_', '') : ride.driver_id);
        const userDoc = await db.collection('users').doc(String(driverUid)).get();
        if (userDoc.exists) {
          const u = userDoc.data()!;
          ride.driver_name = ride.driver_name || u.name || u.displayName || u.full_name;
          ride.driver_phone = hasDirectAccess ? (u.phone_number || u.phone || null) : null;
          ride.driver_email = hasDirectAccess ? (u.email || u.corporate_email || null) : null;
          ride.driver_photo = u.photo_url || u.photoURL || u.avatar_path || null;
        }

        if (ride.driver_id) {
          const driverDoc = await db.collection('drivers').doc(String(ride.driver_id)).get();
          if (driverDoc.exists) {
            const d = driverDoc.data()!;
            ride.driver_name = ride.driver_name || d.name;
            ride.driver_phone = hasDirectAccess ? (ride.driver_phone || d.phone || null) : null;
            ride.vehicle = ride.vehicle || d.vehicle_model || d.vehicle_type;
            ride.vehicle_plate = hasDirectAccess ? (ride.vehicle_plate || d.vehicle_plate) : (ride.vehicle_plate ? `${String(ride.vehicle_plate).slice(0, 4)}••••` : null);
          }
        }

        // Enrich with driver's live GPS telemetry ONLY for active ride participants
        if (hasDirectAccess) {
          try {
            const coordDoc = await db.collection('device_coordinates').doc(String(driverUid)).get();
            if (coordDoc.exists) {
              const cData = coordDoc.data()!;
              if (cData.current_location?.lat && cData.current_location?.lng) {
                ride.live_telemetry = {
                  lat: cData.current_location.lat,
                  lng: cData.current_location.lng,
                  speed: cData.speed ?? 0,
                  bearing: cData.bearing ?? 0,
                  last_updated: cData.last_updated ?? null,
                };
              }
            }
          } catch { /* non-critical enrichment */ }
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
  // ── Edit a ride the driver already posted ────────────────────────────────
  // Price and pickup stops only. Route, timing and seat count are deliberately
  // NOT editable: riders booked against those, and silently moving them under
  // a paid booking is a different (and much larger) problem than fixing a typo
  // in the fare.
  //
  // An existing booking keeps the price it was made at — `price_split` is
  // copied onto the booking at purchase, so changing it here affects only
  // future bookings and never retro-charges anyone.
  fastify.patch('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const uid = String(request.user!.id);
    const body = (request.body || {}) as {
      price_split?: number;
      pickup_points?: any[];
      requires_approval?: boolean;
    };

    const rideRef = db.collection('rides').doc(id);
    const rideDoc = await rideRef.get();
    if (!rideDoc.exists) return reply.code(404).send({ error: 'Ride not found.' });

    const ride = rideDoc.data()!;
    if (String(ride.driver_uid ?? ride.driver_id) !== uid) {
      return reply.code(403).send({ error: 'Forbidden: only the ride driver can edit this ride.' });
    }
    // Once a ride is under way its terms are fixed — riders are in the car.
    const current = String(ride.status || 'SCHEDULED');
    if (current !== 'SCHEDULED') {
      return reply.code(409).send({
        error: 'NOT_EDITABLE',
        message: `A ${current.toLowerCase()} ride can no longer be edited.`,
        current_status: current,
      });
    }

    const updates: Record<string, any> = {};

    if (body.price_split !== undefined) {
      const price = Number(body.price_split);
      if (!Number.isFinite(price) || price < 0) {
        return reply.code(400).send({ error: 'INVALID_PRICE', message: 'Enter a valid price per seat.' });
      }
      updates.price_split = round2(price);
    }

    if (body.pickup_points !== undefined) {
      if (!Array.isArray(body.pickup_points)) {
        return reply.code(400).send({ error: 'INVALID_PICKUP_POINTS', message: 'Pickup points must be a list.' });
      }
      if (body.pickup_points.length > MAX_PICKUP_POINTS) {
        return reply.code(400).send({
          error: 'TOO_MANY_PICKUP_POINTS',
          message: `At most ${MAX_PICKUP_POINTS} pickup points.`,
        });
      }
      // Shares normalisePickupPoints with ride creation so an edited stop
      // carries its arrival time in exactly the same shape as a created one.
      const cleaned = normalisePickupPoints(body.pickup_points);
      if (cleaned.length !== body.pickup_points.length) {
        return reply.code(400).send({
          error: 'INVALID_PICKUP_POINTS',
          message: 'Every pickup point needs a valid location — pick them from the suggestions.',
        });
      }
      updates.pickup_points = cleaned;
    }

    if (body.requires_approval !== undefined) {
      updates.requires_approval = body.requires_approval === true;
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'NOTHING_TO_UPDATE', message: 'Send a price or pickup points to change.' });
    }

    updates.updated_at = new Date().toISOString();
    await rideRef.update(updates);

    // Riders who already booked chose this ride on its old terms, so tell them
    // it moved. Best-effort: a push failure must not fail the edit.
    if (updates.price_split !== undefined || updates.pickup_points !== undefined) {
      activeRiderUids(id).then((riders) => {
        for (const rider of riders) {
          sendPushToUser(rider, 'Ride updated',
            'The driver changed the details of a ride you booked. Your fare is unchanged.',
            { type: 'RIDE_UPDATED', ride_id: id });
        }
      }).catch(() => { /* notifications are best-effort */ });
    }

    const fresh = await rideRef.get();
    const data = fresh.data()!;
    return reply.send({
      id,
      updated: true,
      price_split: data.price_split,
      pickup_points: data.pickup_points ?? [],
    });
  });

  fastify.patch('/:id/status', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };
    const uid = String(request.user!.id);

    if (!isSettableStatus(status)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${SETTABLE_STATUSES.join(', ')}` });
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

      // Enforce the lifecycle. Without this a driver could COMPLETE a ride that
      // never STARTED (settling escrow for passengers who were never picked up),
      // or re-COMPLETE a finished ride.
      const current = String(ride.status || 'SCHEDULED');
      if (!canTransition(current, status)) {
        return reply.code(409).send({
          error: 'INVALID_TRANSITION',
          message: `Cannot move a ${current} ride to ${status}.`,
          current_status: current,
        });
      }

      if (status !== 'COMPLETED') {
        await rideRef.update({ status, updated_at: new Date().toISOString() });

        // A driver cancelling refunds every held booking IN FULL — fare and
        // insurance. The rider did nothing wrong, so the rider-side
        // cancellation tiers in lib/fees deliberately do not apply here; those
        // price a rider changing their mind, not a driver withdrawing the ride.
        //
        // This previously did nothing at all: riders were pushed "Any amount
        // paid is being refunded" while their money stayed in escrow.
        if (status === 'CANCELLED') {
          const heldSnap = await db.collection('bookings')
            .where('ride_id', '==', id)
            .where('escrow_status', '==', 'HELD')
            .get();

          for (const bookingDoc of heldSnap.docs) {
            const booking = bookingDoc.data();
            const riderUid = String(booking.rider_uid ?? booking.rider_id ?? '');
            if (!riderUid) continue;
            const refund = round2(
              (Number(booking.amount_paid) || 0) + (Number(booking.insurance_premium) || 0)
            );
            const riderWalletRef = db.collection('wallets').doc(riderUid);

            try {
              await db.runTransaction(async (tx) => {
                // All reads before writes, per Firestore.
                const freshBooking = await tx.get(bookingDoc.ref);
                if (freshBooking.data()?.escrow_status !== 'HELD') return; // already settled
                const walletDoc = await tx.get(riderWalletRef);
                const cur = walletDoc.exists
                  ? walletDoc.data()!
                  : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };

                tx.update(bookingDoc.ref, {
                  escrow_status: 'CANCELLED',
                  payment_status: 'CANCELLED_REFUNDED',
                  cancelled_by: 'DRIVER',
                  cancellation_fee: 0,
                  refunded_amount: refund,
                  cancelled_at: new Date().toISOString(),
                });
                tx.set(riderWalletRef, {
                  ...cur,
                  available_wallet_balance: round2((cur.available_wallet_balance || 0) + refund),
                }, { merge: true });
              });
            } catch (err) {
              // Never let one rider's refund abort the rest, but make it loud:
              // this is stranded money and needs manual reconciliation.
              fastify.log.error({ err, booking: bookingDoc.id, ride: id },
                'Driver-cancel refund failed for booking');
            }
          }
        }

        // Tell the riders. Fire-and-forget: a push failure must never stop a
        // driver starting or cancelling their trip.
        if (status === 'STARTED') {
          notifyRideStarted(id, fastify.log).catch(() => { /* notifications are best-effort */ });
        } else if (status === 'CANCELLED') {
          notifyDriverCancelledRide(id, fastify.log).catch(() => { /* notifications are best-effort */ });
        }
        return reply.send({ id, status, updated: true });
      }

      // ── COMPLETED: start the payout clock, do not pay yet ─────────────────
      // This used to settle escrow inline, which left a rider no recourse if a
      // ride was marked complete wrongly — the money was simply gone. It now
      // records the completion and lets it mature: the rider has a short window
      // to dispute, and the fare settles only after the hold elapses with no
      // dispute (see lib/settlement and POST /settle-due).
      const completedAt = new Date().toISOString();
      const dueAt = settlementDueAt(completedAt);

      const heldSnap = await db.collection('bookings')
        .where('ride_id', '==', id)
        .where('escrow_status', '==', 'HELD')
        .get();

      // ── Riders the driver never decided on ────────────────────────────────
      // A booking still REQUESTED at completion was paid for and never
      // accepted. Left in the settlement set it is treated as a NO-SHOW, which
      // keeps 20% of the fare from someone who was never given a seat — they
      // did not fail to turn up, they were never let on.
      //
      // They are refunded in full instead, exactly as a driver decline does.
      // Seven riders had already reached this state before it was caught.
      const unapproved = heldSnap.docs.filter(
        (d) => String(d.data().booking_status ?? 'CONFIRMED') === 'REQUESTED'
      );
      for (const d of unapproved) {
        const b = d.data();
        const riderUid = String(b.rider_id ?? b.rider_uid ?? '');
        const refund = round2(Number(b.total_paid) || 0);
        if (!riderUid || refund <= 0) continue;

        // Card/UPI goes back to source; wallet-funded goes back to the wallet.
        let sourceRefundId: string | null = null;
        if (b.payment_method === 'RAZORPAY' && b.razorpay_payment_id) {
          try {
            const r = await refundPaymentToSource({
              paymentId: String(b.razorpay_payment_id),
              amountRupees: refund,
              referenceId: `unapproved_${d.id}`,
              notes: { reason: 'RIDE_COMPLETED_WITHOUT_APPROVAL', ride_id: id },
            });
            sourceRefundId = r.refund_id;
          } catch (err) {
            fastify.log.error(
              { err, booking: d.id },
              'Refund to source failed for an unapproved rider at completion'
            );
          }
        }
        if (b.route_transfer_id) {
          await reverseTransfer(String(b.route_transfer_id)).catch((err) =>
            fastify.log.error({ err, booking: d.id }, 'Route reversal failed for unapproved rider')
          );
        }

        try {
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(d.ref);
            if (fresh.data()?.escrow_status !== 'HELD') return;
            const walletRef = db.collection('wallets').doc(riderUid);
            const wallet = await tx.get(walletRef);
            tx.update(d.ref, {
              booking_status: 'DECLINED',
              escrow_status: 'CANCELLED',
              payment_status: 'CANCELLED_REFUNDED',
              cancelled_by: 'SYSTEM_UNAPPROVED_AT_COMPLETION',
              refunded_amount: refund,
              refund_destination: sourceRefundId ? 'SOURCE' : 'WALLET',
              refund_id: sourceRefundId,
              decided_at: completedAt,
            });
            if (!sourceRefundId) {
              const cur = wallet.exists
                ? wallet.data()!
                : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: defaultCurrency() };
              tx.set(walletRef, {
                ...cur,
                available_wallet_balance: round2((cur.available_wallet_balance || 0) + refund),
              }, { merge: true });
            }
          });
        } catch (err) {
          fastify.log.error({ err, booking: d.id }, 'Failed to refund an unapproved rider at completion');
        }
      }

      const unapprovedIds = new Set(unapproved.map((d) => d.id));
      const toSettle = heldSnap.docs.filter((d) => !unapprovedIds.has(d.id));

      const batch = db.batch();
      batch.update(rideRef, {
        status,
        completed_at: completedAt,
        settlement_due_at: dueAt,
        updated_at: completedAt,
      });
      // Stamped on each booking too, so the sweep can select on the booking
      // alone and a per-rider dispute can block just that rider's payout.
      for (const d of toSettle) {
        batch.update(d.ref, { completed_at: completedAt, settlement_due_at: dueAt });
      }
      await batch.commit();

      notifyRideCompleted(id, fastify.log).catch(() => { /* best-effort */ });

      return reply.send({
        id,
        status,
        updated: true,
        completed_at: completedAt,
        settlement_due_at: dueAt,
        bookings_awaiting_settlement: toSettle.length,
        unapproved_refunded: unapproved.length,
        dispute_window_minutes: DISPUTE_WINDOW_MINUTES,
      });
    } catch (err: any) {
      if (err.message === 'ALREADY_COMPLETED') {
        return reply.code(409).send({ error: 'This ride has already been completed.' });
      }
      fastify.log.error(err, 'Failed to update ride status');
      return reply.code(500).send({ error: 'Failed to update ride status.' });
    }
  });
}
