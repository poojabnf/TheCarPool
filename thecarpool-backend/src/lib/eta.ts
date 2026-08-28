/**
 * When the driver reaches each stop.
 *
 * Two sources, in strict order of trust:
 *   1. A time the DRIVER entered. They know their route and how they drive;
 *      nothing computed should ever override that.
 *   2. Google Directions, as a fallback, marked approximate everywhere it
 *      surfaces so a rider never mistakes an estimate for a commitment.
 *
 * The pure scheduling maths lives here and is unit-tested. The Directions call
 * is the only part that touches the network, and it is cached per route
 * because a ride's leg durations do not change between riders viewing them —
 * without that, one ride with five riders refreshing would bill five lookups
 * for an identical answer.
 */
import { isMapsConfigured } from './maps';

export interface StopInput {
  label: string;
  lat: number;
  lng: number;
  /** ISO time the driver committed to, when they gave one. */
  driver_eta?: string | null;
}

export interface StopEta {
  label: string;
  lat: number;
  lng: number;
  /** ISO arrival time, or null when neither source could produce one. */
  eta: string | null;
  /** True when this came from the driver rather than from Directions. */
  driver_specified: boolean;
}

/** Cache of leg durations (seconds) keyed by the route's coordinates. */
const legCache = new Map<string, { at: number; legs: number[] }>();
const LEG_CACHE_TTL_MS = 60 * 60 * 1000; // an hour; road conditions drift slowly
const LEG_CACHE_MAX = 300;

function routeKey(origin: { lat: number; lng: number }, stops: StopInput[]): string {
  // 4dp ≈ 11m — enough to distinguish stops, coarse enough that trivial
  // coordinate jitter still hits the same cache entry.
  const p = (n: number) => n.toFixed(4);
  return [`${p(origin.lat)},${p(origin.lng)}`, ...stops.map((s) => `${p(s.lat)},${p(s.lng)}`)].join('|');
}

function cacheGet(key: string): number[] | null {
  const hit = legCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LEG_CACHE_TTL_MS) {
    legCache.delete(key);
    return null;
  }
  return hit.legs;
}

function cacheSet(key: string, legs: number[]): void {
  if (legCache.size >= LEG_CACHE_MAX) {
    const oldest = legCache.keys().next().value;
    if (oldest !== undefined) legCache.delete(oldest);
  }
  legCache.set(key, { at: Date.now(), legs });
}

/**
 * Leg durations in seconds: origin→stop1, stop1→stop2, …
 * Returns null when Directions is unavailable or the shape is unexpected, so
 * the caller falls back to driver times only rather than inventing numbers.
 */
export async function fetchLegDurations(
  origin: { lat: number; lng: number },
  stops: StopInput[]
): Promise<number[] | null> {
  if (!isMapsConfigured() || stops.length === 0) return null;

  const key = routeKey(origin, stops);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const waypoints = stops.slice(0, -1).map((s) => `via:${s.lat},${s.lng}`).join('|');
    const last = stops[stops.length - 1];
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
    url.searchParams.set('destination', `${last.lat},${last.lng}`);
    if (waypoints) url.searchParams.set('waypoints', waypoints);
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY as string);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data: any = await res.json();
    const legs = data?.routes?.[0]?.legs;
    if (!Array.isArray(legs) || legs.length === 0) return null;

    const durations = legs.map((l: any) => Number(l?.duration?.value) || 0);
    if (durations.some((d: number) => d <= 0)) return null;
    cacheSet(key, durations);
    return durations;
  } catch {
    return null;
  }
}

/**
 * Resolve an arrival time for every stop.
 *
 * A driver-entered time always wins, and also RE-ANCHORS everything after it:
 * if the driver says they will be at stop 2 at 09:30, stops 3+ are computed
 * forward from 09:30, not from the departure time. Otherwise one late stop
 * would leave every later estimate quietly wrong.
 *
 * Pure: `legSeconds` is passed in, so this is testable without Google.
 */
export function resolveStopEtas(
  departureIso: string,
  stops: StopInput[],
  legSeconds: number[] | null
): StopEta[] {
  const departure = Date.parse(String(departureIso));
  const haveLegs = Array.isArray(legSeconds) && legSeconds.length >= stops.length;

  // The clock we advance through the route. Starts at departure.
  let cursor = Number.isFinite(departure) ? departure : NaN;

  return stops.map((stop, i) => {
    const driverTime = Date.parse(String(stop.driver_eta ?? ''));
    if (Number.isFinite(driverTime)) {
      // Trust it, and continue from here.
      cursor = driverTime;
      return {
        label: stop.label, lat: stop.lat, lng: stop.lng,
        eta: new Date(driverTime).toISOString(),
        driver_specified: true,
      };
    }

    if (Number.isFinite(cursor) && haveLegs) {
      cursor = cursor + (legSeconds as number[])[i] * 1000;
      return {
        label: stop.label, lat: stop.lat, lng: stop.lng,
        eta: new Date(cursor).toISOString(),
        driver_specified: false,
      };
    }

    // Neither a driver time nor a usable estimate — say nothing rather than guess.
    return {
      label: stop.label, lat: stop.lat, lng: stop.lng,
      eta: null, driver_specified: false,
    };
  });
}

/** Minutes from `now` until `iso`; negative once it has passed. */
export function minutesUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / 60000);
}

/** How close to a stop's ETA the "be ready" nudge goes out. */
export const BOARDING_REMINDER_MINUTES = 30;
/**
 * Half-width of the window around that mark.
 *
 * The sweep runs periodically rather than continuously, so a reminder is due
 * anywhere in [30-7, 30+7] minutes. Without a window a stop could fall between
 * two sweeps and never be reminded at all.
 */
export const BOARDING_REMINDER_GRACE_MINUTES = 7;

/** Is this stop due its 30-minute "be ready" nudge right now? */
export function needsBoardingReminder(
  etaIso: string | null | undefined,
  alreadySent: boolean,
  now: Date = new Date()
): boolean {
  if (alreadySent) return false;
  const mins = minutesUntil(etaIso, now);
  if (mins === null) return false;
  return (
    mins <= BOARDING_REMINDER_MINUTES + BOARDING_REMINDER_GRACE_MINUTES &&
    mins >= BOARDING_REMINDER_MINUTES - BOARDING_REMINDER_GRACE_MINUTES
  );
}
