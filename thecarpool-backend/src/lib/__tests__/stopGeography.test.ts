import {
  isStopOnRoute,
  partitionStopsByRoute,
  metresBetween,
} from '../stopGeography';

// The real ride that exposed this: Jhansi -> New Delhi, published with a stop
// the driver believed was Agra.
const JHANSI = { lat: 25.4487, lng: 78.5699 };
const NEW_DELHI = { lat: 28.6429, lng: 77.2191 };

const MATHURA = { lat: 27.5054, lng: 77.6692, label: 'Shri Krishna Janmasthan' };
const AGRA = { lat: 27.1795, lng: 78.0211, label: 'Agra Fort' };
const GWALIOR = { lat: 26.2124, lng: 78.1772, label: 'Gwalior' };
const DATIA = { lat: 25.6653, lng: 78.4609, label: 'Datia' };
// What the picker actually returned for "AGR": a business in Goa.
const AGR_AUTOMATION = { lat: 15.5344, lng: 73.8208, label: 'AGR Automation' };

describe('metresBetween', () => {
  it('measures a known intercity distance', () => {
    const km = metresBetween(JHANSI.lat, JHANSI.lng, NEW_DELHI.lat, NEW_DELHI.lng) / 1000;
    expect(km).toBeGreaterThan(350);
    expect(km).toBeLessThan(420);
  });

  it('is zero for a point against itself', () => {
    expect(metresBetween(AGRA.lat, AGRA.lng, AGRA.lat, AGRA.lng)).toBeCloseTo(0);
  });
});

describe('isStopOnRoute', () => {
  it('accepts every genuine stop along Jhansi to New Delhi', () => {
    for (const stop of [DATIA, GWALIOR, AGRA, MATHURA]) {
      expect(isStopOnRoute(stop, JHANSI, NEW_DELHI)).toBe(true);
    }
  });

  // The bug, named.
  it('rejects the Goa business the picker offered for "AGR"', () => {
    expect(isStopOnRoute(AGR_AUTOMATION, JHANSI, NEW_DELHI)).toBe(false);
  });

  it('accepts a stop at either endpoint', () => {
    expect(isStopOnRoute(JHANSI, JHANSI, NEW_DELHI)).toBe(true);
    expect(isStopOnRoute(NEW_DELHI, JHANSI, NEW_DELHI)).toBe(true);
  });

  // A driver detouring to collect someone is normal; the rule exists to catch
  // a stop on the wrong side of the country, not to police routing.
  it('tolerates a real detour off the straight line', () => {
    const detour = { lat: 26.9124, lng: 75.7873 }; // Jaipur — well west of the direct line
    expect(isStopOnRoute(detour, JHANSI, NEW_DELHI)).toBe(true);
  });

  it('scales with trip length: the same offset is fine on a long run, not a short one', () => {
    const shortA = { lat: 28.6139, lng: 77.209 };  // Delhi
    const shortB = { lat: 28.5355, lng: 77.391 };  // Noida, ~20 km
    expect(isStopOnRoute(AGRA, shortA, shortB)).toBe(false);
    expect(isStopOnRoute(AGRA, JHANSI, NEW_DELHI)).toBe(true);
  });

  // Without endpoints there is nothing to judge against, and rejecting every
  // stop would be worse than accepting one that might be wrong.
  it('accepts anything when the route endpoints are unknown', () => {
    expect(isStopOnRoute(AGR_AUTOMATION, null, null)).toBe(true);
    expect(isStopOnRoute(AGR_AUTOMATION, JHANSI, undefined)).toBe(true);
  });
});

describe('partitionStopsByRoute', () => {
  it('separates the real stops from the impossible one, keeping labels', () => {
    const { onRoute, offRoute } = partitionStopsByRoute(
      [DATIA, GWALIOR, AGR_AUTOMATION, MATHURA], JHANSI, NEW_DELHI
    );
    expect(onRoute.map((s) => s.label)).toEqual(['Datia', 'Gwalior', 'Shri Krishna Janmasthan']);
    expect(offRoute.map((s) => s.label)).toEqual(['AGR Automation']);
  });

  it('reports nothing off-route for a clean ride', () => {
    const { offRoute } = partitionStopsByRoute([DATIA, GWALIOR, AGRA], JHANSI, NEW_DELHI);
    expect(offRoute).toEqual([]);
  });

  it('handles an empty stop list', () => {
    expect(partitionStopsByRoute([], JHANSI, NEW_DELHI)).toEqual({ onRoute: [], offRoute: [] });
  });
});
