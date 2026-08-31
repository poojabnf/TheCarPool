import {
  routePosition,
  isForwardTravel,
  metresBetween,
  PROGRESS_EPSILON,
} from '../routeProgress';

// The real ride that exposed this, stored the way rides actually are: two
// coordinates, origin and destination, with the stops held separately.
const JHANSI = { lat: 25.4487, lng: 78.5699 };
const NEW_DELHI = { lat: 28.6429, lng: 77.2191 };
const ROUTE = [JHANSI, NEW_DELHI];

const DATIA = { lat: 25.6653, lng: 78.4609 };
const GWALIOR = { lat: 26.2124, lng: 78.1772 };
const AGRA = { lat: 27.1795, lng: 78.0211 };
const MATHURA = { lat: 27.5054, lng: 77.6692 };

const progressOf = (p: { lat: number; lng: number }) => routePosition(ROUTE, p)!.progress;

describe('routePosition', () => {
  it('puts the origin at 0 and the destination at 1', () => {
    expect(progressOf(JHANSI)).toBeCloseTo(0, 2);
    expect(progressOf(NEW_DELHI)).toBeCloseTo(1, 2);
  });

  it('orders the stops the way the driver drives them', () => {
    const seq = [DATIA, GWALIOR, AGRA, MATHURA].map(progressOf);
    const sorted = [...seq].sort((a, b) => a - b);
    expect(seq).toEqual(sorted);
  });

  // The bug: on a two-point route these all snapped to one of two vertex
  // indices, so anything past halfway was indistinguishable from the drop.
  it('separates stops that both snapped to the destination vertex', () => {
    const agra = progressOf(AGRA);
    const mathura = progressOf(MATHURA);
    expect(agra).toBeGreaterThan(0.4);
    expect(agra).toBeLessThan(1);
    expect(mathura).toBeGreaterThan(agra);
    expect(mathura).toBeLessThan(1);
  });

  it('reports how far off the route a point is', () => {
    const off = routePosition(ROUTE, { lat: 15.5344, lng: 73.8208 })!; // Goa
    expect(off.distance).toBeGreaterThan(800_000);
    const on = routePosition(ROUTE, AGRA)!;
    expect(on.distance).toBeLessThan(60_000);
  });

  it('returns null when there is no route to project onto', () => {
    expect(routePosition([], AGRA)).toBeNull();
    expect(routePosition(null, AGRA)).toBeNull();
    expect(routePosition(undefined, AGRA)).toBeNull();
  });

  it('survives a route whose points are all identical', () => {
    const pos = routePosition([JHANSI, JHANSI], AGRA);
    expect(pos).not.toBeNull();
    expect(Number.isFinite(pos!.progress)).toBe(true);
  });

  it('weights progress by segment length, not segment count', () => {
    // A short hop then a long haul: the junction sits early in the journey,
    // not at the halfway mark a count-based measure would imply.
    const legs = [JHANSI, DATIA, NEW_DELHI];
    const junction = routePosition(legs, DATIA)!.progress;
    expect(junction).toBeLessThan(0.2);
  });
});

describe('isForwardTravel', () => {
  const at = (p: { lat: number; lng: number }) => routePosition(ROUTE, p);

  // Each of these returned nothing before the fix.
  it('allows boarding at a stop and riding to the destination', () => {
    expect(isForwardTravel(at(AGRA), at(NEW_DELHI))).toBe(true);
    expect(isForwardTravel(at(MATHURA), at(NEW_DELHI))).toBe(true);
  });

  it('allows riding from the origin to a stop', () => {
    expect(isForwardTravel(at(JHANSI), at(AGRA))).toBe(true);
  });

  it('allows travelling between two stops', () => {
    expect(isForwardTravel(at(GWALIOR), at(AGRA))).toBe(true);
    expect(isForwardTravel(at(AGRA), at(MATHURA))).toBe(true);
  });

  it('still refuses to carry anyone backwards', () => {
    expect(isForwardTravel(at(NEW_DELHI), at(AGRA))).toBe(false);
    expect(isForwardTravel(at(MATHURA), at(GWALIOR))).toBe(false);
    expect(isForwardTravel(at(AGRA), at(JHANSI))).toBe(false);
  });

  it('refuses a journey that starts and ends in the same place', () => {
    expect(isForwardTravel(at(AGRA), at(AGRA))).toBe(false);
  });

  it('is not fooled into a backwards trip by two pins metres apart', () => {
    const nudged = { lat: AGRA.lat + 0.0001, lng: AGRA.lng };
    expect(metresBetween(AGRA, nudged)).toBeLessThan(20);
    expect(isForwardTravel(at(nudged), at(AGRA))).toBe(false);
  });

  it('treats a missing position as no match rather than guessing', () => {
    expect(isForwardTravel(null, at(NEW_DELHI))).toBe(false);
    expect(isForwardTravel(at(AGRA), null)).toBe(false);
  });

  it('has a tolerance small enough not to swallow a real leg', () => {
    const agra = at(AGRA)!.progress;
    const mathura = at(MATHURA)!.progress;
    expect(mathura - agra).toBeGreaterThan(PROGRESS_EPSILON * 10);
  });
});
