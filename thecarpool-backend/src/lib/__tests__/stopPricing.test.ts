import {
  matchStop,
  farePerSeatForPickup,
  validateStopPrices,
  normaliseStopPrice,
  proportionalStopFare,
  STOP_MATCH_TOLERANCE_DEG,
} from '../stopPricing';

// Delhi → Mumbai at ₹500, picking up at Jaipur (₹400) and Surat (₹200).
const JAIPUR = { label: 'Jaipur', lat: 26.9124, lng: 75.7873, price: 400 };
const SURAT = { label: 'Surat', lat: 21.1702, lng: 72.8311, price: 200 };
const UNPRICED = { label: 'Vadodara', lat: 22.3072, lng: 73.1812, price: null };
const STOPS = [JAIPUR, SURAT, UNPRICED];
const RIDE_PRICE = 500;

describe('matchStop', () => {
  it('finds the stop a rider is standing on', () => {
    expect(matchStop(STOPS, JAIPUR.lat, JAIPUR.lng)?.label).toBe('Jaipur');
  });

  it('tolerates a pin dropped across the road', () => {
    const nudge = STOP_MATCH_TOLERANCE_DEG / 2;
    expect(matchStop(STOPS, JAIPUR.lat + nudge, JAIPUR.lng - nudge)?.label).toBe('Jaipur');
  });

  it('does not match a different city', () => {
    expect(matchStop(STOPS, 28.6139, 77.209)).toBeNull(); // Delhi
  });

  it('returns null for junk rather than throwing', () => {
    expect(matchStop(null, 1, 1)).toBeNull();
    expect(matchStop(STOPS, NaN, NaN)).toBeNull();
  });
});

describe('farePerSeatForPickup', () => {
  const at = (lat: number, lng: number) =>
    farePerSeatForPickup({ ridePrice: RIDE_PRICE, stops: STOPS, pickupLat: lat, pickupLng: lng });

  it('charges the stop fare to someone joining part way', () => {
    const r = at(SURAT.lat, SURAT.lng);
    expect(r.farePerSeat).toBe(200);
    expect(r.isStopFare).toBe(true);
    expect(r.viaStopLabel).toBe('Surat');
  });

  it('charges the full fare from the origin', () => {
    const r = at(28.6139, 77.209); // Delhi — not a declared stop
    expect(r.farePerSeat).toBe(RIDE_PRICE);
    expect(r.isStopFare).toBe(false);
  });

  it('charges the full fare at an unpriced stop when no route is supplied', () => {
    // Without route geometry there is no way to know how far along the stop
    // is, so there is no basis for a discount. With a route, the proportional
    // fallback applies instead — see the suite further down.
    const r = at(UNPRICED.lat, UNPRICED.lng);
    expect(r.farePerSeat).toBe(RIDE_PRICE);
    expect(r.isStopFare).toBe(false);
    expect(r.viaStopLabel).toBe('Vadodara');
  });

  it('falls back UP to the full fare, never down, when nothing matches', () => {
    // The failure mode of a bad match must be "charged the normal price",
    // never "travelled most of the way for nothing".
    expect(farePerSeatForPickup({
      ridePrice: RIDE_PRICE, stops: undefined, pickupLat: 1, pickupLng: 1,
    }).farePerSeat).toBe(RIDE_PRICE);
  });

  it('clamps a stop price above the full fare', () => {
    // Boarding later can never cost more than riding the whole way, whatever
    // a stale client or hand-edited document says.
    const r = farePerSeatForPickup({
      ridePrice: 500,
      stops: [{ label: 'X', lat: 1, lng: 1, price: 900 }],
      pickupLat: 1, pickupLng: 1,
    });
    expect(r.farePerSeat).toBe(500);
  });

  it('clamps a negative stop price to zero rather than paying the rider', () => {
    const r = farePerSeatForPickup({
      ridePrice: 500,
      stops: [{ label: 'X', lat: 1, lng: 1, price: -50 }],
      pickupLat: 1, pickupLng: 1,
    });
    expect(r.farePerSeat).toBe(0);
  });

  it('supports a genuinely free leg', () => {
    const r = farePerSeatForPickup({
      ridePrice: 500,
      stops: [{ label: 'Free hop', lat: 1, lng: 1, price: 0 }],
      pickupLat: 1, pickupLng: 1,
    });
    expect(r.farePerSeat).toBe(0);
    expect(r.isStopFare).toBe(true);
  });
});

describe('validateStopPrices', () => {
  it('accepts stops priced at or below the full fare', () => {
    expect(validateStopPrices(STOPS, RIDE_PRICE).valid).toBe(true);
    expect(validateStopPrices([{ label: 'A', lat: 1, lng: 1, price: 500 }], 500).valid).toBe(true);
  });

  it('rejects a stop dearer than the whole journey, and says which', () => {
    const r = validateStopPrices([{ label: 'Surat', lat: 1, lng: 1, price: 700 }], 500);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('Surat');
  });

  it('rejects a negative fare', () => {
    expect(validateStopPrices([{ label: 'A', lat: 1, lng: 1, price: -1 }], 500).valid).toBe(false);
  });

  it('rejects a non-numeric fare instead of storing NaN', () => {
    expect(validateStopPrices([{ label: 'A', lat: 1, lng: 1, price: 'free' as any }], 500).valid).toBe(false);
  });

  it('accepts stops with no price at all — the default for every ride', () => {
    expect(validateStopPrices([{ label: 'A', lat: 1, lng: 1 }], 500).valid).toBe(true);
    expect(validateStopPrices([{ label: 'A', lat: 1, lng: 1, price: null }], 500).valid).toBe(true);
  });
});

describe('normaliseStopPrice', () => {
  it('keeps a real number, rounded to paise', () => {
    expect(normaliseStopPrice(200)).toBe(200);
    expect(normaliseStopPrice('249.999')).toBe(250);
  });

  it('treats blank and unusable input as "no separate price"', () => {
    expect(normaliseStopPrice('')).toBeNull();
    expect(normaliseStopPrice(undefined)).toBeNull();
    expect(normaliseStopPrice(null)).toBeNull();
    expect(normaliseStopPrice('abc')).toBeNull();
    expect(normaliseStopPrice(-5)).toBeNull();
  });

  it('keeps an explicit zero, which is a real price', () => {
    expect(normaliseStopPrice(0)).toBe(0);
  });
});

/**
 * The rule that matters: nobody pays for distance they do not travel.
 *
 * A declared stop with no price used to charge the FULL journey fare, so a
 * rider joining halfway through a 1000 km run paid the whole 1000 km price
 * because the driver had not filled in a box.
 */
describe('proportional fare for a stop the driver did not price', () => {
  // Delhi (0 km) → Surat (~700 km) → Mumbai (~1000 km), straight-line.
  const DELHI = { lat: 28.6139, lng: 77.2090 };
  const SURAT = { lat: 21.1702, lng: 72.8311 };
  const MUMBAI = { lat: 19.0760, lng: 72.8777 };
  const ROUTE = [DELHI, SURAT, MUMBAI];
  const FULL = 1000;

  const fareAt = (pt: { lat: number; lng: number }, stops: any[]) =>
    farePerSeatForPickup({
      ridePrice: FULL, stops, routeCoords: ROUTE,
      pickupLat: pt.lat, pickupLng: pt.lng,
    });

  it('charges much less than the full fare at an unpriced late stop', () => {
    const r = fareAt(SURAT, [{ label: 'Surat', lat: SURAT.lat, lng: SURAT.lng }]);
    expect(r.farePerSeat).toBeLessThan(FULL);
    expect(r.isStopFare).toBe(true);
    expect(r.isEstimated).toBe(true);
  });

  it('prices the remaining distance, not the distance already covered', () => {
    // Surat→Mumbai is a small tail of Delhi→Mumbai, so the fare should be a
    // small fraction — certainly under a third.
    const r = fareAt(SURAT, [{ label: 'Surat', lat: SURAT.lat, lng: SURAT.lng }]);
    expect(r.farePerSeat).toBeLessThan(FULL / 3);
    expect(r.farePerSeat).toBeGreaterThan(0);
  });

  it("still prefers the driver's own price when they set one", () => {
    // An explicit price is a decision; the estimate is only a fallback.
    const r = fareAt(SURAT, [{ label: 'Surat', lat: SURAT.lat, lng: SURAT.lng, price: 350 }]);
    expect(r.farePerSeat).toBe(350);
    expect(r.isEstimated).toBeUndefined();
  });

  it('charges the full fare from the origin, where nothing is saved', () => {
    const r = fareAt(DELHI, [{ label: 'Delhi', lat: DELHI.lat, lng: DELHI.lng }]);
    expect(r.farePerSeat).toBe(FULL);
  });

  it('keeps the full fare when the route is too sparse to judge', () => {
    // No invented discount without evidence of a shorter journey.
    const r = farePerSeatForPickup({
      ridePrice: FULL, stops: [{ label: 'X', lat: 1, lng: 1 }],
      routeCoords: [], pickupLat: 1, pickupLng: 1,
    });
    expect(r.farePerSeat).toBe(FULL);
    expect(r.isStopFare).toBe(false);
  });

  it('charges the full fare when the rider is not at a declared stop', () => {
    // Off-route riders have no known position along the journey, so the safe
    // assumption is that they are travelling all of it.
    const r = fareAt({ lat: 26.9124, lng: 75.7873 }, [
      { label: 'Surat', lat: SURAT.lat, lng: SURAT.lng },
    ]);
    expect(r.farePerSeat).toBe(FULL);
    expect(r.isStopFare).toBe(false);
  });
});

describe('proportionalStopFare', () => {
  const ROUTE = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }];

  it('halves the fare at the halfway point', () => {
    const f = proportionalStopFare({ ridePrice: 400, routeCoords: ROUTE, stopLat: 0, stopLng: 1 });
    expect(f).toBe(200);
  });

  it('is zero at the destination — there is nothing left to travel', () => {
    // Guarded by the caller, which keeps the full fare rather than a free ride.
    expect(proportionalStopFare({ ridePrice: 400, routeCoords: ROUTE, stopLat: 0, stopLng: 2 })).toBeNull();
  });

  it('returns null rather than guessing when there is no usable route', () => {
    expect(proportionalStopFare({ ridePrice: 400, routeCoords: [], stopLat: 0, stopLng: 0 })).toBeNull();
    expect(proportionalStopFare({ ridePrice: 400, routeCoords: null, stopLat: 0, stopLng: 0 })).toBeNull();
  });

  it('never exceeds the full fare', () => {
    const f = proportionalStopFare({ ridePrice: 400, routeCoords: ROUTE, stopLat: 0, stopLng: -5 });
    expect(f).not.toBeNull();
    expect(f!).toBeLessThanOrEqual(400);
  });
});
