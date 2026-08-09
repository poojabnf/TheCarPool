/**
 * When to notify a rider about their trip. Pure — no I/O — so the timing rules
 * are unit-testable rather than only observable in production.
 *
 * Four moments a rider is told about:
 *   1. an hour before departure  — time to get ready
 *   2. the driver is approaching — time to go outside
 *   3. the trip has started
 *   4. the trip has ended
 *
 * (2) is driven by live telemetry, the rest by time or driver action.
 */

/** Reminders fire when departure is this close, and no earlier. */
export const DEPARTURE_REMINDER_MS = 60 * 60 * 1000;

/**
 * How late a reminder may still be sent. A sweep that runs every few minutes
 * can drift; without a floor, a ride whose reminder was missed would get one
 * moments before departure, which is worse than useless. Beyond this we skip.
 */
export const REMINDER_GRACE_MS = 15 * 60 * 1000;

/** Distance at which a driver counts as "arriving" at a rider's pickup. */
export const ARRIVING_RADIUS_M = 350;

export interface RemindableRide {
  departure_time?: string | null;
  status?: string | null;
  /** Set once the reminder has gone out, so it never repeats. */
  departure_reminder_sent?: boolean;
}

/**
 * Should this ride's riders be reminded now?
 *
 * True only inside the window [departure - 1h, departure - 45m], for a ride
 * still SCHEDULED, that hasn't already been reminded. Everything else is a no.
 */
export function needsDepartureReminder(ride: RemindableRide, now: Date = new Date()): boolean {
  if (ride?.departure_reminder_sent === true) return false;
  if (String(ride?.status ?? 'SCHEDULED') !== 'SCHEDULED') return false;

  const departure = Date.parse(String(ride?.departure_time ?? ''));
  if (!Number.isFinite(departure)) return false;

  const until = departure - now.getTime();
  // Already gone, or too late to be useful.
  if (until <= DEPARTURE_REMINDER_MS - REMINDER_GRACE_MS) return false;
  // Still more than an hour out.
  if (until > DEPARTURE_REMINDER_MS) return false;
  return true;
}

/** Minutes until departure, rounded, for use in the message text. */
export function minutesUntil(departureIso: string, now: Date = new Date()): number {
  const t = Date.parse(String(departureIso));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((t - now.getTime()) / 60000));
}

/** Metres between two coordinates (haversine). */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Is the driver close enough to a rider's pickup to warn them to come out?
 * Returns false on missing/invalid coordinates rather than treating (0,0) as a
 * real place — a bad pickup point would otherwise fire the moment a driver
 * anywhere near the Gulf of Guinea started moving.
 */
export function isArrivingAtPickup(
  driver: { lat: number; lng: number },
  pickup: { lat?: number | null; lng?: number | null } | null | undefined,
  radiusM: number = ARRIVING_RADIUS_M
): boolean {
  const plat = Number(pickup?.lat);
  const plng = Number(pickup?.lng);
  if (!Number.isFinite(plat) || !Number.isFinite(plng)) return false;
  if (plat === 0 && plng === 0) return false;
  if (!Number.isFinite(driver?.lat) || !Number.isFinite(driver?.lng)) return false;
  return metresBetween(driver.lat, driver.lng, plat, plng) <= radiusM;
}
