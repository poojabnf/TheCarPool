/**
 * When an unfinished ride should be closed out for the driver.
 *
 * A driver marks their ride COMPLETED, and that is what releases escrow. When
 * they simply never do -- they forget, they uninstall, their phone dies -- the
 * ride sits in STARTED forever and every rider's money sits with it. Nobody is
 * refunded, nobody is paid, and no screen anywhere says why.
 *
 * So a ride gets a deadline proportional to how far it is going: 48 hours per
 * 500 km, which is the rate the operator asked for (500 km -> 2 days,
 * 1000 -> 4, 1500 -> 6) and continues smoothly between and beyond those
 * points rather than stepping at bucket edges.
 *
 * Generous on purpose. This is not a punctuality rule and must never close a
 * trip that is still happening -- a 500 km drive takes eight hours or so, and
 * this waits six times that before intervening. It exists to stop money being
 * held indefinitely by inaction, and the cost of firing late is a slow refund
 * while the cost of firing early is closing a ride with people still in the car.
 *
 * Pure and I/O-free, so the arithmetic can be tested without Firestore.
 */

/** Hours allowed per 500 km travelled. */
export const HOURS_PER_500_KM = 48;

/**
 * No ride closes sooner than this, however short.
 *
 * A 20 km commute works out at under two hours on the rate above, which would
 * close a ride while the driver was still parking. A day is the shortest
 * window in which "they have abandoned this" is a fair conclusion.
 */
export const MIN_HOURS = 24;

/**
 * Nor later than this, however long.
 *
 * The rate alone would hold a rider's fare for over a fortnight on the longest
 * domestic routes. Past two weeks the balance flips: an unresolved booking is
 * doing more harm than an early close, and there is a dispute path for the
 * rare genuine case.
 */
export const MAX_HOURS = 14 * 24;

/**
 * Assumed distance when a ride records none.
 *
 * Older rides stored no distance_km at all. 500 km buys the standard 48 hours
 * -- longer than the overwhelming majority of real journeys need, and short
 * enough that a forgotten ride still resolves within days.
 */
export const ASSUMED_KM = 500;

/** Straight-line kilometres understate road distance; scale up before pricing time against them. */
export const ROAD_WINDING_FACTOR = 1.3;

export function hoursAllowedFor(distanceKm: number | null | undefined): number {
  const km = Number(distanceKm);
  const usable = Number.isFinite(km) && km > 0 ? km : ASSUMED_KM;
  const raw = (usable / 500) * HOURS_PER_500_KM;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, raw));
}

export interface Coord { lat: number; lng: number }

/**
 * Fall back to the route's own geometry when distance_km is missing.
 *
 * Straight-line, then padded by ROAD_WINDING_FACTOR, because roads bend and
 * under-measuring here shortens someone's deadline.
 */
export function distanceFromRoute(routeCoords: Coord[] | null | undefined): number | null {
  const pts = (routeCoords ?? []).filter(
    (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
  if (pts.length < 2) return null;
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  let km = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    km += 2 * R * Math.asin(Math.sqrt(h));
  }
  return km > 0 ? km * ROAD_WINDING_FACTOR : null;
}

export interface RideForDeadline {
  distance_km?: number | null;
  route_coords?: Coord[] | null;
  /** When the driver actually set off. */
  started_at?: string | null;
  /** Advertised departure, used when started_at was never recorded. */
  departure_time?: string | null;
}

export interface Deadline {
  /** ISO instant after which the ride may be closed. */
  at: string;
  hours: number;
  kmUsed: number;
  /** Where the distance came from, for the audit line on the closed ride. */
  basis: 'distance_km' | 'route_coords' | 'assumed';
}

/**
 * The instant a started ride becomes closable.
 *
 * Measured from departure, not from now, so a sweep that has not run for a
 * week does not silently grant every ride another week.
 *
 * Returns null when there is no usable start time: a ride with no clock to
 * measure from must be left alone rather than closed on a guessed one.
 */
export function closeDeadline(ride: RideForDeadline): Deadline | null {
  const startedRaw = ride.started_at || ride.departure_time;
  const startedAt = Date.parse(String(startedRaw ?? ''));
  if (!Number.isFinite(startedAt)) return null;

  let km = Number(ride.distance_km);
  let basis: Deadline['basis'] = 'distance_km';
  if (!Number.isFinite(km) || km <= 0) {
    const derived = distanceFromRoute(ride.route_coords);
    if (derived !== null) { km = derived; basis = 'route_coords'; }
    else { km = ASSUMED_KM; basis = 'assumed'; }
  }

  const hours = hoursAllowedFor(km);
  return {
    at: new Date(startedAt + hours * 3600 * 1000).toISOString(),
    hours,
    kmUsed: Math.round(km * 10) / 10,
    basis,
  };
}

/** Is this ride past its deadline as of `now`? */
export function isPastCloseDeadline(ride: RideForDeadline, now: Date = new Date()): boolean {
  const d = closeDeadline(ride);
  if (!d) return false;
  return now.getTime() >= Date.parse(d.at);
}
