// Google Maps Routes API integration for ride waypoint optimization.
// Falls back to a nearest-neighbour heuristic when no API key is configured,
// so the endpoint always returns a sensible order.

type LatLng = { lat: number; lng: number };

export function isMapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

export interface PlaceResult {
  place_name: string;
  address: string;
  latitude: number;
  longitude: number;
  place_id?: string;
}

/**
 * Look up real places by free-text query via the Google Places Text Search API.
 * Returns results with coordinates in a single call (so the client gets usable
 * lat/lng immediately). Returns null on any failure (no key, REQUEST_DENIED,
 * network error) so callers can fall back to the local dataset.
 */
export async function searchPlaces(query: string): Promise<PlaceResult[] | null> {
  if (!isMapsConfigured()) return null;
  try {
    const url =
      'https://maps.googleapis.com/maps/api/place/textsearch/json' +
      `?query=${encodeURIComponent(query)}&region=in&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    // OK / ZERO_RESULTS are usable; anything else (REQUEST_DENIED, OVER_QUERY_LIMIT)
    // means the key lacks Places API — signal a fallback.
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return null;
    return (data.results || []).slice(0, 8).map((r: any) => ({
      place_name: r.name,
      address: r.formatted_address || '',
      latitude: r.geometry?.location?.lat ?? 0,
      longitude: r.geometry?.location?.lng ?? 0,
      place_id: r.place_id,
    }));
  } catch {
    return null;
  }
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371e3;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Nearest-neighbour ordering of waypoints starting from `origin`. Returns the
 * indices of `waypoints` in visiting order. Deterministic, no network.
 */
export function nearestNeighbourOrder(origin: LatLng, waypoints: LatLng[]): number[] {
  const remaining = waypoints.map((_, i) => i);
  const order: number[] = [];
  let current = origin;
  while (remaining.length) {
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const d = haversineMeters(current, waypoints[remaining[k]]);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    const idx = remaining.splice(best, 1)[0];
    order.push(idx);
    current = waypoints[idx];
  }
  return order;
}

export interface OptimizeResult {
  order: number[];                 // indices into the input waypoints, optimized
  source: 'google' | 'heuristic';
  total_distance_meters?: number;
  total_duration_seconds?: number;
}

/**
 * Optimize the visiting order of pickup waypoints between origin and
 * destination. Uses the Google Routes API when a key is present; otherwise a
 * nearest-neighbour heuristic.
 */
export async function optimizeRoute(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[],
): Promise<OptimizeResult> {
  if (waypoints.length === 0) {
    return { order: [], source: isMapsConfigured() ? 'google' : 'heuristic' };
  }

  if (!isMapsConfigured()) {
    return { order: nearestNeighbourOrder(origin, waypoints), source: 'heuristic' };
  }

  try {
    const body = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      intermediates: waypoints.map((w) => ({ location: { latLng: { latitude: w.lat, longitude: w.lng } } })),
      travelMode: 'DRIVE',
      optimizeWaypointOrder: true,
    };

    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY as string,
        'X-Goog-FieldMask':
          'routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Routes API ${res.status}`);
    const data: any = await res.json();
    const route = data.routes?.[0];
    const order: number[] = route?.optimizedIntermediateWaypointIndex ?? waypoints.map((_, i) => i);
    const durationSec = route?.duration ? parseInt(String(route.duration).replace('s', ''), 10) : undefined;

    return {
      order,
      source: 'google',
      total_distance_meters: route?.distanceMeters,
      total_duration_seconds: Number.isFinite(durationSec) ? durationSec : undefined,
    };
  } catch {
    // Network/API failure — degrade gracefully to the heuristic.
    return { order: nearestNeighbourOrder(origin, waypoints), source: 'heuristic' };
  }
}
