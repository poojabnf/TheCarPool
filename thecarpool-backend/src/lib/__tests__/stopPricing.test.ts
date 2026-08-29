import {
  matchStop,
  farePerSeatForPickup,
  validateStopPrices,
  normaliseStopPrice,
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

  it('charges the full fare at a stop the driver did not price', () => {
    // A stop with no price is not free — it just has no discount.
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
