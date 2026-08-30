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
  riderCancelledBooking, driverCancelledRide, rideStarted, rideOfferedSuccess,
  driverEarningsSettled, riderRefundCredited,
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
      luggage_note: booking?.luggage_note ?? null,
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

/** Rider cancelled their booking: notify the driver that a seat has freed up. */
export async function notifyRiderCancelledBooking(
  ids: BookingContextIds,
  booking: Record<string, any>,
  log?: Log
): Promise<void> {
  try {
    const r = await resolve(ids, booking);
    await dispatch(
      r.driverUid, r.driverPhone,
      riderCancelledBooking(r.ctx),
      { type: 'BOOKING_CANCELLED_BY_RIDER', booking_id: String(booking.id), ride_id: ids.rideId },
      log
    );
  } catch (err) {
    log?.error({ err, ...ids }, 'Rider-cancelled notification failed');
  }
}

/** Driver cancelled the ride: notify all riders that the trip was cancelled and refunded. */
export async function notifyDriverCancelledRide(
  rideId: string,
  log?: Log
): Promise<void> {
  try {
    const snap = await db.collection('bookings')
      .where('ride_id', '==', rideId)
      .get();
    await Promise.all(snap.docs.map(async (d) => {
      const b = d.data();
      const riderUid = String(b.rider_id ?? b.rider_uid ?? '');
      if (!riderUid) return;
      const r = await resolve({ rideId, riderUid }, b);
      await dispatch(
        riderUid, r.riderPhone,
        driverCancelledRide(r.ctx),
        { type: 'RIDE_CANCELLED_BY_DRIVER', booking_id: d.id, ride_id: rideId },
        log
      );
    }));
  } catch (err) {
    log?.error({ err, rideId }, 'Driver-cancelled fan-out notification failed');
  }
}

/** Driver started the ride: notify all confirmed passengers with live tracking hint. */
export async function notifyRideStarted(
  rideId: string,
  log?: Log
): Promise<void> {
  try {
    const snap = await db.collection('bookings')
      .where('ride_id', '==', rideId)
      .where('escrow_status', '==', 'HELD')
      .get();
    await Promise.all(snap.docs.map(async (d) => {
      const b = d.data();
      const riderUid = String(b.rider_id ?? b.rider_uid ?? '');
      if (!riderUid) return;
      const r = await resolve({ rideId, riderUid }, b);
      await dispatch(
        riderUid, r.riderPhone,
        rideStarted(r.ctx),
        { type: 'RIDE_STARTED', booking_id: d.id, ride_id: rideId },
        log
      );
    }));
  } catch (err) {
    log?.error({ err, rideId }, 'Ride-started fan-out notification failed');
  }
}

/** Driver successfully posted a ride: confirmation push to the driver. */
export async function notifyRideOffered(
  rideId: string,
  driverUid: string,
  ride: Record<string, any>,
  log?: Log
): Promise<void> {
  try {
    const r = await resolve({ rideId, riderUid: driverUid, driverUid }, null);
    await dispatch(
      driverUid, r.driverPhone,
      rideOfferedSuccess({
        origin: ride.source || null,
        destination: ride.destination || null,
        departure_time: ride.departure_time || null,
        seats: ride.seats_total || undefined,
      }),
      { type: 'RIDE_OFFERED', ride_id: rideId },
      log
    );
  } catch (err) {
    log?.error({ err, rideId, driverUid }, 'Ride-offered notification failed');
  }
}


/**
 * Wait for a notification to actually go out, but never longer than it is
 * worth holding the response for.
 *
 * These were all fired without `await`, on the reasoning that a booking has
 * already taken money by the time anyone is notified, so a failed push must
 * not fail the booking. That reasoning is still right. The problem is where it
 * runs: Cloud Run has `cpu-throttling: true`, which cuts the container's CPU
 * to near zero the instant the HTTP response is flushed. Work that has been
 * started but not awaited is simply frozen mid-flight — and resumes only if
 * another request happens to arrive and wake the instance up.
 *
 * That is the whole explanation for "sometimes I get a push, sometimes not".
 * It was never random: notifyUser() writes the Firestore inbox record first
 * and calls FCM second, so on a quiet instance the record lands and the push
 * never leaves. Which is exactly what production shows — an unbroken run of
 * notification documents for every booking, and pushes that only sometimes
 * arrive.
 *
 * Awaiting with a ceiling fixes it without a platform change: the send gets
 * the CPU it needs because the request is still open, and a slow provider
 * costs the caller at most `ms` rather than hanging the booking.
 *
 * The ceiling is 9s rather than the 4s it started at, because the ceiling is
 * not a timeout: hitting it does not cancel the work, it just stops waiting
 * for it -- and once the response flushes, whatever is left is frozen exactly
 * as before. So the ceiling has to clear the SLOWEST stage, not the typical
 * one. A cancel or a start fans out to every rider on the ride and was
 * measured at 4.10s in production, i.e. already past the old limit, while a
 * booking's two messages take about 2s. Latency here is paid only on actions
 * that are rare and deliberate, and a driver waiting an extra second beats a
 * carload of riders never hearing that their ride was cancelled.
 */
export function deliver(work: Promise<unknown>, log?: Log, ms = 9000): Promise<void> {
  return Promise.race([
    work.catch((err) => { log?.error({ err }, 'Notification dispatch failed'); }),
    new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()),
  ]).then(() => undefined);
}

/**
 * Settlement: tell the driver their earnings were released, and any rider who
 * got money back that it landed.
 *
 * Called after the settlement transaction commits, never inside it — Firestore
 * retries a transaction body, and a retried notification is a duplicate push.
 *
 * `riderRefunds` is keyed by rider uid. Riders with nothing coming back are
 * simply absent, so no one is told about a zero.
 */
export async function notifySettlement(
  rideId: string,
  opts: {
    driverUid?: string | null;
    driverAmount: number;
    toBank: boolean;
    destination?: string | null;
    riderRefunds?: Map<string, number> | Array<[string, number]>;
    currency?: string;
  },
  log?: Log
): Promise<void> {
  const money = (n: number) =>
    `${opts.currency ?? '₹'}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const jobs: Promise<void>[] = [];

  if (opts.driverUid && opts.driverAmount > 0) {
    const { ctx, driverPhone } = await resolve({ rideId, riderUid: '', driverUid: opts.driverUid });
    jobs.push(dispatch(
      String(opts.driverUid),
      driverPhone,
      driverEarningsSettled(ctx, money(opts.driverAmount), opts.toBank, opts.destination),
      { type: 'EARNINGS_SETTLED', ride_id: rideId },
      log
    ));
  }

  for (const [riderUid, amount] of opts.riderRefunds ?? []) {
    if (!riderUid || !(amount > 0)) continue;
    const { ctx, riderPhone } = await resolve({ rideId, riderUid });
    jobs.push(dispatch(
      riderUid,
      riderPhone,
      riderRefundCredited(ctx, money(amount)),
      { type: 'REFUND_CREDITED', ride_id: rideId },
      log
    ));
  }

  await Promise.all(jobs);
}
