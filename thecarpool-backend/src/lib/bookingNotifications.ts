/**
 * Turns a booking event into a message and sends it.
 *
 * The I/O half of the notification feature: reads the ride, driver and rider,
 * builds the privacy-safe body from lib/rideMessages, and dispatches through
 * lib/notify (push now; SMS and WhatsApp when configured).
 *
 * Everything here is best-effort by design. A booking has already taken money
 * and reserved a seat by the time we notify anyone, so a failed push must
 * never surface as a failed booking — callers fire these without awaiting.
 */
import { db } from './firestore';
import { notifyUser } from './notify';
import { fetchLegDurations, resolveStopEtas, StopInput } from './eta';
import { DISPUTE_WINDOW_MINUTES } from './settlement';
import {
  RideMessageContext, BuiltMessage,
  riderBookingConfirmed, riderRequestSubmitted, driverBookingRequested,
  driverBookingConfirmed, riderRequestDeclined, riderBoardingSoon, riderRideCompleted,
} from './rideMessages';

type Log = { error: (...args: any[]) => void };

/** Human vehicle description: "White Maruti Swift", falling back gracefully. */
function vehicleOf(ride: Record<string, any> | null): string | null {
  if (!ride) return null;
  const parts = [ride.vehicle_colour, ride.vehicle_make, ride.vehicle_model].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return ride.vehicle_type ? String(ride.vehicle_type).toLowerCase() : null;
}

/**
 * Resolve each stop's arrival time for display.
 *
 * Driver-entered times win; Google fills the rest and is cached per route.
 * Never throws — a missing ETA just means the stop shows without a time.
 */
async function stopsWithEtas(ride: Record<string, any> | null): Promise<RideMessageContext['stops']> {
  const raw = Array.isArray(ride?.pickup_points) ? ride!.pickup_points : [];
  if (raw.length === 0) return [];

  const stops: StopInput[] = raw
    .filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
    .map((p: any) => ({
      label: String(p.label || 'Stop'),
      lat: p.lat,
      lng: p.lng,
      driver_eta: p.eta ?? p.driver_eta ?? null,
    }));
  if (stops.length === 0) return [];

  const origin = ride?.route_coords?.[0];
  let legs: number[] | null = null;
  if (origin && typeof origin.lat === 'number' && typeof origin.lng === 'number') {
    legs = await fetchLegDurations({ lat: origin.lat, lng: origin.lng }, stops);
  }

  return resolveStopEtas(String(ride?.departure_time ?? ''), stops, legs).map((s) => ({
    label: s.label,
    eta: s.eta,
    driver_specified: s.driver_specified,
  }));
}

export interface BookingContextIds {
  rideId: string;
  riderUid: string;
  /** Read from the ride when omitted. */
  driverUid?: string | null;
}

interface Resolved {
  ctx: RideMessageContext;
  riderPhone: string | null;
  driverPhone: string | null;
  driverUid: string | null;
}

/**
 * Gather everything the messages need in one pass.
 *
 * Phone numbers are read only to DELIVER over SMS/WhatsApp — they are never
 * placed in a message body. rideMessages scrubs bodies regardless, so a leak
 * would have to survive both layers.
 */
async function resolve(ids: BookingContextIds, booking?: Record<string, any> | null): Promise<Resolved> {
  const rideSnap = await db.collection('rides').doc(String(ids.rideId)).get();
  const ride = rideSnap.exists ? rideSnap.data()! : null;
  const driverUid = ids.driverUid ?? ride?.driver_uid ?? ride?.driver_id ?? null;

  const [riderSnap, driverSnap] = await Promise.all([
    db.collection('users').doc(String(ids.riderUid)).get(),
    driverUid ? db.collection('users').doc(String(driverUid)).get() : Promise.resolve(null as any),
  ]);
  const rider = riderSnap?.exists ? riderSnap.data()! : null;
  const driver = driverSnap?.exists ? driverSnap.data()! : null;

  return {
    driverUid: driverUid ? String(driverUid) : null,
    riderPhone: rider?.phone ?? null,
    driverPhone: driver?.phone ?? null,
    ctx: {
      driver_name: driver?.name ?? null,
      rider_name: rider?.name ?? null,
      vehicle: vehicleOf(ride),
      mode: ride?.vehicle_type ?? ride?.ride_type ?? null,
      origin: ride?.source ?? null,
      destination: ride?.destination ?? null,
      departure_time: ride?.departure_time ?? null,
      stops: await stopsWithEtas(ride),
      seats: booking?.seats_booked ?? undefined,
      otp: booking?.boarding_otp ?? null,
      pickup_point: booking?.pickup_label ?? null,
    },
  };
}

async function dispatch(
  uid: string | null,
  phone: string | null,
  message: BuiltMessage,
  data: Record<string, string>,
  log?: Log
): Promise<void> {
  if (!uid) return;
  await notifyUser({ uid, phone }, message, data, log);
}

/** Rider asked for a seat: tell the rider it is pending, and the driver it arrived. */
export async function notifyBookingRequested(
  ids: BookingContextIds,
  booking: Record<string, any>,
  log?: Log
): Promise<void> {
  try {
    const r = await resolve(ids, booking);
    const data = { type: 'BOOKING_REQUESTED', booking_id: String(booking.id), ride_id: ids.rideId };
    await Promise.all([
      dispatch(ids.riderUid, r.riderPhone, riderRequestSubmitted(r.ctx), data, log),
      dispatch(r.driverUid, r.driverPhone, driverBookingRequested(r.ctx), data, log),
    ]);
  } catch (err) {
    log?.error({ err, ...ids }, 'Booking-requested notification failed');
  }
}

/** Seat is confirmed — instantly, or because the driver accepted. */
export async function notifyBookingConfirmed(
  ids: BookingContextIds,
  booking: Record<string, any>,
  log?: Log
): Promise<void> {
  try {
    const r = await resolve(ids, booking);
    const data = { type: 'BOOKING_CONFIRMED', booking_id: String(booking.id), ride_id: ids.rideId };
    await Promise.all([
      // Only the rider's own message carries their boarding code.
      dispatch(ids.riderUid, r.riderPhone, riderBookingConfirmed(r.ctx), data, log),
      dispatch(r.driverUid, r.driverPhone, driverBookingConfirmed({ ...r.ctx, otp: null }), data, log),
    ]);
  } catch (err) {
    log?.error({ err, ...ids }, 'Booking-confirmed notification failed');
  }
}

/**
 * "Be ready" nudge, roughly 30 minutes before the driver reaches this rider.
 * Carries the boarding code, since it is the message they will have open.
 */
export async function notifyBoardingSoon(
  ids: BookingContextIds,
  booking: Record<string, any>,
  minutes: number,
  log?: Log
): Promise<void> {
  try {
    const r = await resolve(ids, booking);
    await dispatch(
      ids.riderUid, r.riderPhone,
      riderBoardingSoon(r.ctx, minutes),
      { type: 'BOARDING_SOON', booking_id: String(booking.id), ride_id: ids.rideId },
      log
    );
  } catch (err) {
    log?.error({ err, ...ids }, 'Boarding-soon notification failed');
  }
}

/**
 * Stop arrival times for a ride, reusing the shared resolver so the sweep and
 * the messages can never disagree about when the driver reaches a stop.
 */
export async function resolveStopEtasForRide(
  ride: Record<string, any>,
  rawStops: any[]
): Promise<{ label: string; lat: number; lng: number; eta: string | null }[]> {
  const stops: StopInput[] = (rawStops || [])
    .filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
    .map((p: any) => ({
      label: String(p.label || 'Stop'),
      lat: p.lat,
      lng: p.lng,
      driver_eta: p.eta ?? p.driver_eta ?? null,
    }));
  if (stops.length === 0) return [];

  const origin = ride?.route_coords?.[0];
  const legs = origin && typeof origin.lat === 'number'
    ? await fetchLegDurations({ lat: origin.lat, lng: origin.lng }, stops)
    : null;

  return resolveStopEtas(String(ride?.departure_time ?? ''), stops, legs)
    .map((s) => ({ label: s.label, lat: s.lat, lng: s.lng, eta: s.eta }));
}

/** One rider's ride is complete — tell them, with the dispute deadline. */
export async function notifyRideCompletedForBooking(
  ids: BookingContextIds,
  booking: Record<string, any>,
  log?: Log
): Promise<void> {
  try {
    const r = await resolve(ids, booking);
    await dispatch(
      ids.riderUid, r.riderPhone,
      riderRideCompleted(r.ctx, DISPUTE_WINDOW_MINUTES),
      { type: 'RIDE_COMPLETED', booking_id: String(booking.id), ride_id: ids.rideId },
      log
    );
  } catch (err) {
    log?.error({ err, ...ids }, 'Ride-completed notification failed');
  }
}

/** Whole-ride completion: notify every rider still holding a fare on it. */
export async function notifyRideCompleted(rideId: string, log?: Log): Promise<void> {
  try {
    const snap = await db.collection('bookings')
      .where('ride_id', '==', rideId)
      .where('escrow_status', '==', 'HELD')
      .get();
    await Promise.all(snap.docs.map((d) => {
      const b = d.data();
      return notifyRideCompletedForBooking(
        { rideId, riderUid: String(b.rider_id ?? b.rider_uid) },
        { ...b, id: d.id },
        log
      );
    }));
  } catch (err) {
    log?.error({ err, ride_id: rideId }, 'Ride-completed fan-out failed');
  }
}

/** Driver turned the request down; the rider has been refunded. */
export async function notifyBookingDeclined(
  ids: BookingContextIds,
  booking: Record<string, any>,
  log?: Log
): Promise<void> {
  try {
    const r = await resolve(ids, booking);
    await dispatch(
      ids.riderUid, r.riderPhone,
      riderRequestDeclined(r.ctx),
      { type: 'BOOKING_DECLINED', booking_id: String(booking.id), ride_id: ids.rideId },
      log
    );
  } catch (err) {
    log?.error({ err, ...ids }, 'Booking-declined notification failed');
  }
}
