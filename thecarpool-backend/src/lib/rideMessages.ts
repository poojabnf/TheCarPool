/**
 * The words we send people about a ride.
 *
 * Pure — no I/O — so the privacy rules below are unit-testable without a
 * network. lib/notify.ts does the sending.
 *
 * PRIVACY RULE, and the reason this module exists at all:
 * a message may name the other party and describe the vehicle, but must NEVER
 * carry a phone number, an email, or a street address that isn't a public
 * meeting point. Riders and drivers reach each other through in-app chat and
 * the masked-call proxy; leaking a number into an SMS or WhatsApp thread
 * removes that protection permanently, for both people, with no way to undo
 * it. `scrubContact` is the backstop, applied to every message body.
 */

export interface RideStopSummary {
  label: string;
  /** ISO time the driver expects to be here, or a Google ETA. Optional. */
  eta?: string | null;
  /** True when the time came from the driver rather than being computed. */
  driver_specified?: boolean;
}

export interface RideMessageContext {
  /** Display name of the counterparty. First name only — see shortName(). */
  driver_name?: string | null;
  rider_name?: string | null;
  vehicle?: string | null;
  /** COMMUTE, BIKE_POOL etc., shown as a human word. */
  mode?: string | null;
  origin?: string | null;
  destination?: string | null;
  stops?: RideStopSummary[];
  departure_time?: string | null;
  seats?: number;
  /** Boarding code. Only ever sent to the rider who owns it. */
  otp?: string | null;
  /** Where this rider is being collected, when it is a declared stop. */
  pickup_point?: string | null;
}

/** Patterns that must never survive into an outbound message. */
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/**
 * Strip anything that looks like a phone number or email.
 *
 * Applied to every body regardless of how it was built: profile fields are
 * user-supplied, and someone putting their number in their display name must
 * not turn every booking message into a contact-sharing channel.
 */
export function scrubContact(text: string): string {
  return text
    .replace(EMAIL_RE, '[hidden]')
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 8 ? '[hidden]' : m))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * First name only.
 *
 * A full name plus a photo plus a car is more identifying than these messages
 * need to be, and surnames are what make someone findable elsewhere.
 */
export function shortName(name: string | null | undefined, fallback = 'your co-traveller'): string {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return first || fallback;
}

/** "Car pool" / "Bike pool" from the stored enum. */
export function modeLabel(mode: string | null | undefined): string {
  const m = String(mode ?? '').toUpperCase();
  if (m === 'BIKE_POOL' || m === 'BIKE') return 'Bike pool';
  if (m === 'CAR_POOL' || m === 'CAR' || m === 'COMMUTE' || m === '') return 'Car pool';
  return m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** "3:00 PM, Wed 26 Aug", or '' when the time is unusable. */
export function formatWhen(iso: string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      weekday: 'short', day: 'numeric', month: 'short',
      timeZone,
    }).format(new Date(t));
  } catch {
    return new Date(t).toISOString();
  }
}

/** Just the clock time, for stop lists where the date is already established. */
export function formatTimeOnly(iso: string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
    }).format(new Date(t));
  } catch {
    return '';
  }
}

/**
 * Stops rendered as lines, each with its time when known.
 *
 * A computed time is marked "approx" so nobody treats a Google estimate as a
 * promise the driver made.
 */
export function stopLines(stops: RideStopSummary[] | undefined): string[] {
  if (!Array.isArray(stops) || stops.length === 0) return [];
  return stops.map((s) => {
    const time = formatTimeOnly(s.eta);
    if (!time) return `• ${s.label}`;
    return `• ${s.label} — ${time}${s.driver_specified ? '' : ' (approx)'}`;
  });
}

function joinLines(lines: (string | null | undefined)[]): string {
  return lines.filter((l) => l !== null && l !== undefined && l !== '').join('\n');
}

export interface BuiltMessage {
  title: string;
  body: string;
}

/** Sent to the RIDER once their seat is confirmed. Carries their OTP. */
export function riderBookingConfirmed(ctx: RideMessageContext): BuiltMessage {
  const when = formatWhen(ctx.departure_time);
  const body = joinLines([
    `Your ${modeLabel(ctx.mode).toLowerCase()} with ${shortName(ctx.driver_name, 'your driver')} is confirmed.`,
    ctx.vehicle ? `Vehicle: ${ctx.vehicle}` : null,
    ctx.origin && ctx.destination ? `Route: ${ctx.origin} → ${ctx.destination}` : null,
    ctx.pickup_point ? `Board at: ${ctx.pickup_point}` : null,
    when ? `Departs: ${when}` : null,
    ctx.seats && ctx.seats > 1 ? `Seats: ${ctx.seats}` : null,
    ...stopLines(ctx.stops).length ? ['Stops:', ...stopLines(ctx.stops)] : [],
    ctx.otp ? `Your boarding code: ${ctx.otp}` : null,
    'Message your driver in the app — we never share phone numbers.',
  ]);
  return { title: 'Booking confirmed', body: scrubContact(body) };
}

/** Sent to the RIDER the moment they request a seat, before the driver replies. */
export function riderRequestSubmitted(ctx: RideMessageContext): BuiltMessage {
  const when = formatWhen(ctx.departure_time);
  const body = joinLines([
    `Seat requested with ${shortName(ctx.driver_name, 'the driver')}.`,
    ctx.origin && ctx.destination ? `Route: ${ctx.origin} → ${ctx.destination}` : null,
    when ? `Departs: ${when}` : null,
    "We'll tell you as soon as they accept. Your payment is held until then.",
  ]);
  return { title: 'Seat requested', body: scrubContact(body) };
}

/** Sent to the DRIVER when a rider asks for a seat. */
export function driverBookingRequested(ctx: RideMessageContext): BuiltMessage {
  const when = formatWhen(ctx.departure_time);
  const body = joinLines([
    `${shortName(ctx.rider_name, 'A rider')} wants ${ctx.seats && ctx.seats > 1 ? `${ctx.seats} seats` : 'a seat'} on your ride.`,
    ctx.origin && ctx.destination ? `Route: ${ctx.origin} → ${ctx.destination}` : null,
    ctx.pickup_point ? `Boarding at: ${ctx.pickup_point}` : null,
    when ? `Departs: ${when}` : null,
    'Open the app to accept or decline.',
  ]);
  return { title: 'New seat request', body: scrubContact(body) };
}

/** Sent to the DRIVER once a booking is confirmed (instant or on acceptance). */
export function driverBookingConfirmed(ctx: RideMessageContext): BuiltMessage {
  const when = formatWhen(ctx.departure_time);
  const body = joinLines([
    `${shortName(ctx.rider_name, 'A rider')} is confirmed on your ride.`,
    ctx.pickup_point ? `Collect at: ${ctx.pickup_point}` : null,
    when ? `Departs: ${when}` : null,
    ctx.seats && ctx.seats > 1 ? `Seats: ${ctx.seats}` : null,
    'Verify their boarding code when they get in.',
  ]);
  return { title: 'Booking confirmed', body: scrubContact(body) };
}

/** Sent to the RIDER when the driver declines their request. */
export function riderRequestDeclined(ctx: RideMessageContext): BuiltMessage {
  const body = joinLines([
    `${shortName(ctx.driver_name, 'The driver')} couldn't take your request this time.`,
    'You have been refunded in full. Search again for other rides on your route.',
  ]);
  return { title: 'Request declined', body: scrubContact(body) };
}

/**
 * Sent to the RIDER ahead of their pickup.
 *
 * `minutes` is how long until the driver reaches THEIR stop, not the ride's
 * departure — being told to be ready 30 minutes before the driver leaves a
 * point an hour away is worse than useless.
 */
export function riderBoardingSoon(ctx: RideMessageContext, minutes: number): BuiltMessage {
  const body = joinLines([
    `${shortName(ctx.driver_name, 'Your driver')} reaches you in about ${minutes} minutes.`,
    ctx.pickup_point ? `Be ready at: ${ctx.pickup_point}` : null,
    ctx.vehicle ? `Look for: ${ctx.vehicle}` : null,
    ctx.otp ? `Boarding code: ${ctx.otp}` : null,
  ]);
  return { title: 'Be ready to board', body: scrubContact(body) };
}
