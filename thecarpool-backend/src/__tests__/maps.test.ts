import { nearestNeighbourOrder, optimizeRoute, isMapsConfigured } from '../lib/maps';

describe('route optimization', () => {
  afterEach(() => { delete process.env.GOOGLE_MAPS_API_KEY; });

  test('nearest-neighbour visits closest waypoints first', () => {
    const origin = { lat: 0, lng: 0 };
    const waypoints = [
      { lat: 0, lng: 3 },   // index 0 — far
      { lat: 0, lng: 1 },   // index 1 — nearest
      { lat: 0, lng: 2 },   // index 2 — middle
    ];
    expect(nearestNeighbourOrder(origin, waypoints)).toEqual([1, 2, 0]);
  });

  test('handles a single waypoint', () => {
    expect(nearestNeighbourOrder({ lat: 10, lng: 10 }, [{ lat: 11, lng: 11 }])).toEqual([0]);
  });

  test('handles empty waypoints', () => {
    expect(nearestNeighbourOrder({ lat: 0, lng: 0 }, [])).toEqual([]);
  });

  test('optimizeRoute falls back to heuristic without an API key', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect(isMapsConfigured()).toBe(false);
    const result = await optimizeRoute(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 5 },
      [{ lat: 0, lng: 2 }, { lat: 0, lng: 1 }]
    );
    expect(result.source).toBe('heuristic');
    expect(result.order).toEqual([1, 0]);
  });

  test('optimizeRoute with no waypoints returns empty order', async () => {
    const result = await optimizeRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, []);
    expect(result.order).toEqual([]);
  });
});
