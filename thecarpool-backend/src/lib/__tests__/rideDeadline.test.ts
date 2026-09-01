import {
  hoursAllowedFor, closeDeadline, isPastCloseDeadline,
  distanceFromRoute, MIN_HOURS, MAX_HOURS, ASSUMED_KM,
} from '../rideDeadline';

describe('hoursAllowedFor', () => {
  // The rate the operator specified, at the points they specified it.
  it('gives 48 hours per 500 km', () => {
    expect(hoursAllowedFor(500)).toBe(48);
    expect(hoursAllowedFor(1000)).toBe(96);   // 4 days
    expect(hoursAllowedFor(1500)).toBe(144);  // 6 days
    expect(hoursAllowedFor(2000)).toBe(192);  // 8 days
  });

  it('scales smoothly between those points rather than stepping', () => {
    expect(hoursAllowedFor(750)).toBe(72);
    expect(hoursAllowedFor(1250)).toBe(120);
  });

  // A 20 km commute works out at under two hours on the rate alone, which
  // would close a ride while the driver was still parking.
  it('never closes a short ride sooner than the floor', () => {
    expect(hoursAllowedFor(20)).toBe(MIN_HOURS);
    expect(hoursAllowedFor(1)).toBe(MIN_HOURS);
    expect(hoursAllowedFor(249)).toBe(MIN_HOURS);
  });

  it('never holds a fare longer than the ceiling', () => {
    expect(hoursAllowedFor(5000)).toBe(MAX_HOURS);
    expect(hoursAllowedFor(100000)).toBe(MAX_HOURS);
  });

  it('assumes a standard journey when distance is missing or junk', () => {
    const standard = hoursAllowedFor(ASSUMED_KM);
    expect(hoursAllowedFor(null)).toBe(standard);
    expect(hoursAllowedFor(undefined)).toBe(standard);
    expect(hoursAllowedFor(0)).toBe(standard);
    expect(hoursAllowedFor(-500)).toBe(standard);
    expect(hoursAllowedFor(NaN)).toBe(standard);
  });
});

describe('distanceFromRoute', () => {
  const JHANSI = { lat: 25.4487, lng: 78.5699 };
  const NEW_DELHI = { lat: 28.6429, lng: 77.2191 };

  it('measures a route and pads it for road winding', () => {
    const km = distanceFromRoute([JHANSI, NEW_DELHI])!;
    expect(km).toBeGreaterThan(400);  // straight line is ~370
    expect(km).toBeLessThan(560);
  });

  it('returns null when there is nothing to measure', () => {
    expect(distanceFromRoute([])).toBeNull();
    expect(distanceFromRoute([JHANSI])).toBeNull();
    expect(distanceFromRoute(null)).toBeNull();
  });
});

describe('closeDeadline', () => {
  const started = '2026-09-01T06:00:00.000Z';

  it('counts from when the driver set off', () => {
    const d = closeDeadline({ distance_km: 500, started_at: started })!;
    expect(d.hours).toBe(48);
    expect(d.at).toBe('2026-09-03T06:00:00.000Z');
    expect(d.basis).toBe('distance_km');
  });

  // Otherwise a sweep that has not run for a week silently grants every ride
  // another week.
  it('measures from departure, not from now', () => {
    const a = closeDeadline({ distance_km: 500, started_at: started })!;
    const b = closeDeadline({ distance_km: 500, started_at: started })!;
    expect(a.at).toBe(b.at);
  });

  it('falls back to the advertised departure when no start was recorded', () => {
    const d = closeDeadline({ distance_km: 1000, departure_time: started })!;
    expect(d.at).toBe('2026-09-05T06:00:00.000Z'); // 4 days
  });

  it('derives distance from the route when the ride records none', () => {
    const d = closeDeadline({
      started_at: started,
      route_coords: [{ lat: 25.4487, lng: 78.5699 }, { lat: 28.6429, lng: 77.2191 }],
    })!;
    expect(d.basis).toBe('route_coords');
    expect(d.kmUsed).toBeGreaterThan(400);
  });

  // A ride with no clock to measure from must be left alone, not closed on a
  // guessed one.
  it('refuses to guess when there is no start time at all', () => {
    expect(closeDeadline({ distance_km: 500 })).toBeNull();
    expect(closeDeadline({ distance_km: 500, started_at: 'nonsense' })).toBeNull();
  });
});

describe('isPastCloseDeadline', () => {
  const started = '2026-09-01T06:00:00.000Z';
  const at = (iso: string) => new Date(iso);

  it('leaves a 500 km ride alone for two days, then closes it', () => {
    const ride = { distance_km: 500, started_at: started };
    expect(isPastCloseDeadline(ride, at('2026-09-02T06:00:00.000Z'))).toBe(false);
    expect(isPastCloseDeadline(ride, at('2026-09-03T05:59:00.000Z'))).toBe(false);
    expect(isPastCloseDeadline(ride, at('2026-09-03T06:00:00.000Z'))).toBe(true);
  });

  // The failure that matters: closing a trip while people are still in the car.
  it('does not close a long ride that is merely still under way', () => {
    const ride = { distance_km: 1500, started_at: started };
    expect(isPastCloseDeadline(ride, at('2026-09-03T06:00:00.000Z'))).toBe(false); // day 2
    expect(isPastCloseDeadline(ride, at('2026-09-06T06:00:00.000Z'))).toBe(false); // day 5
    expect(isPastCloseDeadline(ride, at('2026-09-07T06:00:00.000Z'))).toBe(true);  // day 6
  });

  it('never fires on a ride with no usable start time', () => {
    expect(isPastCloseDeadline({ distance_km: 500 }, at('2030-01-01T00:00:00.000Z'))).toBe(false);
  });
});
