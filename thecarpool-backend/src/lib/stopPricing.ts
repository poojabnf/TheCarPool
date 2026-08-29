/**
 * Per-stop fares.
 *
 * A driver running Delhi to Mumbai at ₹500 a seat may pick riders up part way.
 * Someone boarding at Surat travels a fraction of the distance, and charging
 * them the full ₹500 is the reason they book someone else. The driver can now
 * price each declared stop: the ride price covers the whole journey, and a
 * stop price covers boarding THERE and riding to the destination.
 *
 * Pure — no I/O — because the quote endpoint and the booking endpoint must
 * arrive at the same number. They previously both multiplied ride.price_split
 * by the seat count, which agreed by accident of being one line. Anything more
 * involved than that needs one implementation, or the price a rider is shown
 * and the price they are charged will eventually drift apart.
 */

export interface PricedStop {
  label?: string | null;
  lat: number;
  lng: number;
  eta?: string | null;
  /**
   * Per-seat fare for a rider boarding here. Null means "no separate price" —
   * they pay the full ride fare, which is the behaviour every ride had before
   * this existed and the behaviour any ride keeps unless the driver sets one.
   */
  price?: number | null;
}

/**
 * How close a booking's pickup must be to a declared stop to count as that
 * stop. ~100m: close enough to be the same place, loose enough for map jitter
 * and for a rider dropping their pin across the road.
 *
 * Shared with pickupLabelFor() in the bookings route, deliberately — if the
 * two ever disagreed, a rider could be charged a stop's fare while the
 * notification named a different stop, or vice versa.
 */
export const STOP_MATCH_TOLERANCE_DEG = 0.001;

/** The declared stop a pickup coordinate falls on, or null. */
export function matchStop(
  stops: unknown,
  lat: number,
  lng: number
): PricedStop | null {
  if (!Array.isArray(stops)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hit = stops.find(
    (s: any) =>
      typeof s?.lat === 'number' &&
      typeof s?.lng === 'number' &&
      Math.abs(s.lat - lat) < STOP_MATCH_TOLERANCE_DEG &&
      Math.abs(s.lng - lng) < STOP_MATCH_TOLERANCE_DEG
  );
  return (hit as PricedStop) ?? null;
}

/** Metres between two coordinates. Local so this module stays dependency-free. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Total length of a route polyline, in metres. */
export function routeLengthMetres(routeCoords: unknown): number {
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < routeCoords.length; i++) {
    const a = routeCoords[i - 1] as any;
    const b = routeCoords[i] as any;
    if (typeof a?.lat !== 'number' || typeof b?.lat !== 'number') continue;
    total += metresBetween(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

/**
 * Distance still to travel from a point on the route to the destination.
 *
 * Projects onto the nearest SEGMENT rather than snapping to the nearest
 * vertex. That distinction is the whole feature: a real ride's route is posted
 * as just two points, origin and destination, so vertex-snapping put every
 * intermediate stop at one end or the other. A stop 400 km from the
 * destination snapped to the destination, "remaining" came out as zero, and
 * the rider was charged the full fare — the exact overcharge this is meant to
 * prevent, still happening for every ride in practice.
 *
 * Planar approximation with longitude scaled by cos(latitude). Wrong by a
 * fraction of a percent over an Indian-scale journey, which is far below the
 * precision of a fare the driver can overwrite anyway.
 */
export function remainingMetresFrom(routeCoords: unknown, lat: number, lng: number): number {
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) return 0;
  const pts = (routeCoords as any[]).filter(
    (p) => typeof p?.lat === 'number' && typeof p?.lng === 'number'
  );
  if (pts.length < 2) return 0;

  const M_PER_DEG = 111320;
  const meanLat = (pts[0].lat + pts[pts.length - 1].lat) / 2;
  const kx = Math.cos((meanLat * Math.PI) / 180) * M_PER_DEG;
  const X = (p: { lng: number }) => p.lng * kx;
  const Y = (p: { lat: number }) => p.lat * M_PER_DEG;

  const px = lng * kx;
  const py = lat * M_PER_DEG;

  let bestPerp = Infinity;
  let bestSeg = -1;
  let bestT = 0;

  for (let i = 1; i < pts.length; i++) {
    const ax = X(pts[i - 1]), ay = Y(pts[i - 1]);
    const bx = X(pts[i]), by = Y(pts[i]);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Degenerate segment (repeated point): treat as its start.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const cx = ax + t * dx, cy = ay + t * dy;
    const perp = Math.hypot(px - cx, py - cy);
    if (perp < bestPerp) { bestPerp = perp; bestSeg = i; bestT = t; }
  }
  if (bestSeg === -1) return 0;

  // Remainder of the segment the stop sits on, plus every segment after it.
  let remaining = metresBetween(pts[bestSeg - 1].lat, pts[bestSeg - 1].lng, pts[bestSeg].lat, pts[bestSeg].lng)
    * (1 - bestT);
  for (let i = bestSeg + 1; i < pts.length; i++) {
    remaining += metresBetween(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  }
  return remaining;
}

/**
 * What a stop SHOULD cost, purely from how far it still is to the destination.
 *
 * Someone boarding halfway pays about half. This is the figure the driver's
 * form pre-fills, and the figure used when a driver adds a stop and leaves the
 * fare blank — because charging the full journey price to someone travelling
 * half of it is the behaviour we are trying to remove, and "the driver did not
 * fill in a box" is not a good reason to do it to a rider.
 *
 * Returns null when the route is too sparse to judge, in which case the caller
 * keeps the full fare rather than inventing a discount.
 */
export function proportionalStopFare(opts: {
  ridePrice: number;
  routeCoords: unknown;
  stopLat: number;
  stopLng: number;
}): number | null {
  const full = Math.max(0, Number(opts.ridePrice) || 0);
  const total = routeLengthMetres(opts.routeCoords);
  if (total <= 0) return null;

  const remaining = remainingMetresFrom(opts.routeCoords, opts.stopLat, opts.stopLng);
  if (remaining <= 0) return null;

  const fraction = Math.min(1, remaining / total);
  return Math.round(full * fraction * 100) / 100;
}

export interface PickupFare {
  /** Per-seat fare to charge. */
  farePerSeat: number;
  /** The stop it came from, when a stop price applied. */
  viaStopLabel: string | null;
  /** True when a stop's own price was used rather than the full ride fare. */
  isStopFare: boolean;
  /**
   * True when the fare was worked out from distance because the driver did not
   * set one. The app can say "estimated from distance" rather than implying the
   * driver chose the number.
   */
  isEstimated?: boolean;
}

/**
 * What one seat costs for a rider boarding at this coordinate.
 *
 * Three cases, in order:
 *
 *   1. A declared stop with a price the driver typed  -> that price.
 *   2. A declared stop with NO price                  -> a distance-proportional
 *      fare worked out from how far the stop still is from the destination.
 *   3. No declared stop at all                        -> the full ride fare.
 *
 * Case 2 used to be case 3, and that was wrong. Someone boarding halfway
 * through a 1000 km run was charged the whole 1000 km fare because the driver
 * had not filled in a box. "The driver left a field blank" is not a reason to
 * overcharge a rider for a journey they are not taking.
 *
 * Case 3 still falls back UP to the full fare, deliberately. There the rider is
 * not at a declared stop, so there is nothing to say how far along the route
 * they are — the safe assumption is that they are riding the whole thing. The
 * failure mode of a bad match stays "charged the normal price", never
 * "travelled most of the way for nothing".
 */
export function farePerSeatForPickup(opts: {
  ridePrice: number;
  stops: unknown;
  pickupLat: number;
  pickupLng: number;
  /** Route polyline. Needed for the proportional fallback; omitting it keeps
   *  the old full-fare behaviour for unpriced stops. */
  routeCoords?: unknown;
}): PickupFare {
  const ridePrice = Math.max(0, Number(opts.ridePrice) || 0);
  const stop = matchStop(opts.stops, opts.pickupLat, opts.pickupLng);

  const raw = stop?.price;
  const hasPrice = raw !== null && raw !== undefined && Number.isFinite(Number(raw));

  if (stop && !hasPrice) {
    // Declared stop, no price set: charge for the distance actually travelled.
    const proportional = proportionalStopFare({
      ridePrice,
      routeCoords: opts.routeCoords,
      stopLat: stop.lat,
      stopLng: stop.lng,
    });
    if (proportional !== null && proportional < ridePrice) {
      return {
        farePerSeat: proportional,
        viaStopLabel: stop.label ?? null,
        isStopFare: true,
        isEstimated: true,
      };
    }
  }

  if (!stop || !hasPrice) {
    return { farePerSeat: ridePrice, viaStopLabel: stop?.label ?? null, isStopFare: false };
  }

  // Clamped rather than trusted. A stop price above the full fare would mean
  // boarding later costs more than riding the whole way, and a negative one
  // would pay the rider. Neither should reach a wallet even if a stale client
  // or a hand-edited document produces it.
  const price = Math.min(Math.max(0, Number(raw)), ridePrice);
  return { farePerSeat: price, viaStopLabel: stop.label ?? null, isStopFare: true };
}

export interface StopPriceValidation {
  valid: boolean;
  /** Rider/driver-facing reason, safe to display. */
  reason?: string;
}

/**
 * Check the prices a driver typed before the ride is stored.
 *
 * Rejected rather than clamped at this boundary: the driver is right there and
 * can fix it, and silently changing someone's price to a different number is
 * how a driver ends up carrying people for a fare they never agreed to.
 */
export function validateStopPrices(
  stops: unknown,
  ridePrice: number
): StopPriceValidation {
  if (!Array.isArray(stops)) return { valid: true };
  const full = Math.max(0, Number(ridePrice) || 0);

  for (const s of stops as PricedStop[]) {
    const raw = (s as any)?.price;
    if (raw === null || raw === undefined || raw === '') continue;

    const price = Number(raw);
    if (!Number.isFinite(price)) {
      return { valid: false, reason: 'Stop fares must be numbers.' };
    }
    if (price < 0) {
      return { valid: false, reason: 'A stop fare cannot be negative.' };
    }
    if (price > full) {
      const where = s.label ? `"${s.label}"` : 'a stop';
      return {
        valid: false,
        reason: `The fare for ${where} is more than the full-journey fare. Boarding part way should not cost more than riding the whole route.`,
      };
    }
  }
  return { valid: true };
}

/**
 * Normalise a driver-supplied stop price for storage.
 * Undefined/blank/unusable becomes null, meaning "charge the full fare".
 */
export function normaliseStopPrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
