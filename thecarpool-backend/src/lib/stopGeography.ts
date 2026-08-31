/**
 * Is a declared pickup stop actually on the journey?
 *
 * Nothing checked this. A driver typing "AGR" into the stop picker was offered
 * "AGR Automation" -- a business in Goa -- and a Jhansi to New Delhi ride was
 * published with a stop 1,500 km off its route. Two things then broke quietly:
 *
 *   Search. Stops match riders within 100 km, so anyone searching inside Goa
 *   was offered a ride that never goes near them. One mistyped stop pollutes
 *   an entire region's results.
 *
 *   Pricing. An unpriced stop is charged by the fraction of the route still
 *   remaining, which is meaningless for a point nowhere near the route, so the
 *   rider is quoted a number derived from nonsense.
 *
 * Kept as its own module, with no I/O, so the rule is testable and so ride
 * creation and ride editing cannot drift apart on what counts as on-route.
 */

const EARTH_RADIUS_M = 6_371_000;

export function metresBetween(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * How far a stop may stray before it is not on this journey.
 *
 * Expressed as an ellipse with the origin and destination as its foci: a stop
 * is on-route when going origin -> stop -> destination is not much longer than
 * going direct. That is the question a driver is actually answering ("would I
 * pass through here?"), and unlike a fixed radius it scales with the trip --
 * generous on a 1,500 km run, tight on a 20 km commute.
 *
 * The allowance is deliberately loose. A real detour to collect someone is
 * normal and must not be rejected; this exists to catch a stop on the wrong
 * side of the country, not to second-guess a driver's route.
 */
export const STOP_DETOUR_FACTOR = 1.5;
export const STOP_DETOUR_SLACK_M = 60_000; // 60 km

export interface Coord { lat: number; lng: number }

/**
 * True when a stop plausibly lies along origin -> destination.
 *
 * Returns true when the route endpoints are unknown: without them there is
 * nothing to judge against, and rejecting every stop would be worse than
 * accepting one that may be wrong.
 */
export function isStopOnRoute(
  stop: Coord,
  origin: Coord | null | undefined,
  destination: Coord | null | undefined
): boolean {
  if (!origin || !destination) return true;
  const direct = metresBetween(origin.lat, origin.lng, destination.lat, destination.lng);
  const viaStop =
    metresBetween(origin.lat, origin.lng, stop.lat, stop.lng) +
    metresBetween(stop.lat, stop.lng, destination.lat, destination.lng);
  return viaStop <= direct * STOP_DETOUR_FACTOR + STOP_DETOUR_SLACK_M;
}

export interface StopLike extends Coord { label?: string | null }

/**
 * Split stops into the ones on the route and the ones that cannot be.
 *
 * Returns the offenders rather than dropping them silently. Silence is how the
 * Goa stop shipped: the ride posted successfully and looked correct to the
 * driver, who had no way to know their stop had been thrown away or -- worse
 * -- kept and used.
 */
export function partitionStopsByRoute<T extends StopLike>(
  stops: T[],
  origin: Coord | null | undefined,
  destination: Coord | null | undefined
): { onRoute: T[]; offRoute: T[] } {
  const onRoute: T[] = [];
  const offRoute: T[] = [];
  for (const s of stops) {
    (isStopOnRoute(s, origin, destination) ? onRoute : offRoute).push(s);
  }
  return { onRoute, offRoute };
}
