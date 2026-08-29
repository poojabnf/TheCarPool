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

export interface PickupFare {
  /** Per-seat fare to charge. */
  farePerSeat: number;
  /** The stop it came from, when a stop price applied. */
  viaStopLabel: string | null;
  /** True when a stop's own price was used rather than the full ride fare. */
  isStopFare: boolean;
}

/**
 * What one seat costs for a rider boarding at this coordinate.
 *
 * Falls back to the full ride fare whenever there is no matching stop or the
 * stop carries no price. Falling back UP to the full fare is deliberate: the
 * failure mode of a bad match is then "charged the normal price", never
 * "travelled most of the way for nothing".
 */
export function farePerSeatForPickup(opts: {
  ridePrice: number;
  stops: unknown;
  pickupLat: number;
  pickupLng: number;
}): PickupFare {
  const ridePrice = Math.max(0, Number(opts.ridePrice) || 0);
  const stop = matchStop(opts.stops, opts.pickupLat, opts.pickupLng);

  const raw = stop?.price;
  const hasPrice = raw !== null && raw !== undefined && Number.isFinite(Number(raw));
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
