/**
 * How far along a route a point sits, as a fraction from 0 (origin) to 1
 * (destination).
 *
 * Search needs to know that a rider boards BEFORE they alight, so it compared
 * the index of the nearest route vertex for each. That is only a proxy for
 * progress, and a poor one: rides store `route_coords` as just [origin,
 * destination], so the index could only ever be 0 or 1. Every point past the
 * halfway mark snapped to the destination vertex and compared equal to the
 * drop, so `pickupIndex < dropIndex` was false and the ride was dropped.
 *
 * Measured against a Jhansi -> New Delhi ride: Datia and Gwalior snapped to
 * index 0 and matched, while Agra (181 km from Delhi, 200 km from Jhansi) and
 * Mathura snapped to index 1 and could never be booked. A driver could
 * advertise a stop in the second half of their route that no rider was able to
 * find.
 *
 * Projecting onto the segments instead gives a continuous value, so ordering
 * means something however few vertices the route has. Agra becomes ~0.53 on a
 * two-point route and correctly precedes a drop at 1.0.
 *
 * Pure and I/O-free so the ordering rule can be tested directly, rather than
 * inferred from whether a search happened to return something.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface Coord { lat: number; lng: number }

function toRad(d: number): number { return (d * Math.PI) / 180; }

export function metresBetween(a: Coord, b: Coord): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Local planar projection, in metres, about a reference latitude.
 *
 * Over a single route segment the earth's curvature is irrelevant to which
 * point is nearest, and flat maths makes the projection below simple and
 * exact enough. Longitude is scaled by cos(lat) so a degree east is not
 * treated as a degree north.
 */
function planar(p: Coord, refLat: number): { x: number; y: number } {
  const scale = Math.cos(toRad(refLat));
  return { x: toRad(p.lng) * scale * EARTH_RADIUS_M, y: toRad(p.lat) * EARTH_RADIUS_M };
}

/** Where on segment a->b the point falls: t in [0,1], plus its distance in metres. */
function projectOntoSegment(p: Coord, a: Coord, b: Coord): { t: number; distance: number } {
  const refLat = (a.lat + b.lat) / 2;
  const P = planar(p, refLat), A = planar(a, refLat), B = planar(b, refLat);
  const vx = B.x - A.x, vy = B.y - A.y;
  const lenSq = vx * vx + vy * vy;
  // Degenerate segment (repeated coordinate): distance to the point itself.
  if (lenSq === 0) return { t: 0, distance: metresBetween(p, a) };
  let t = ((P.x - A.x) * vx + (P.y - A.y) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = A.x + t * vx, cy = A.y + t * vy;
  return { t, distance: Math.hypot(P.x - cx, P.y - cy) };
}

export interface RoutePosition {
  /** 0 at the origin, 1 at the destination. */
  progress: number;
  /** Perpendicular distance from the route, in metres. */
  distance: number;
}

/**
 * Project a point onto a route.
 *
 * Returns null when the route has no usable geometry — the caller then has no
 * ordering to apply and must decide for itself, rather than being handed a
 * fabricated 0.
 */
export function routePosition(
  routeCoords: Coord[] | null | undefined,
  point: Coord
): RoutePosition | null {
  const pts = (routeCoords ?? []).filter(
    (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
  if (pts.length === 0) return null;
  if (pts.length === 1) return { progress: 0, distance: metresBetween(point, pts[0]) };

  // Segment lengths up front: progress is a fraction of total route length, so
  // a long segment must count for more than a short one.
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = metresBetween(pts[i], pts[i + 1]);
    segLengths.push(len);
    total += len;
  }
  if (total === 0) return { progress: 0, distance: metresBetween(point, pts[0]) };

  let best: RoutePosition | null = null;
  let cumulative = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const { t, distance } = projectOntoSegment(point, pts[i], pts[i + 1]);
    if (best === null || distance < best.distance) {
      best = { progress: (cumulative + t * segLengths[i]) / total, distance };
    }
    cumulative += segLengths[i];
  }
  return best;
}

/**
 * Does the rider board before they alight?
 *
 * A small tolerance absorbs projection noise on near-identical points, so two
 * pins a few metres apart do not resolve into a backwards journey. It is not a
 * licence to travel the wrong way: a genuine reverse trip is off by far more.
 */
export const PROGRESS_EPSILON = 0.001;

export function isForwardTravel(
  pickup: RoutePosition | null,
  drop: RoutePosition | null
): boolean {
  if (!pickup || !drop) return false;
  return pickup.progress < drop.progress - PROGRESS_EPSILON;
}
