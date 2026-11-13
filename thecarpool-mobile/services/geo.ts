import { apiFetch } from './api';

export interface Place {
  place_name: string;
  state_name?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
}

export type GeoOutcome =
  | { status: 'ok'; places: Place[] }
  /** Query too short to bother the server with — not an error, just nothing yet. */
  | { status: 'idle' }
  | { status: 'error'; message: string };

/**
 * Below this we don't search.
 */
export const MIN_QUERY_LENGTH = 3;

/**
 * Responsive debounce: 250ms feels fast and snappy while preventing excessive requests.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * In-memory client cache to instantly serve repeated or backspaced place searches (0ms latency).
 */
const clientGeoCache = new Map<string, { at: number; places: Place[] }>();
const CLIENT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Quick local suggestions for instant responsive search before network resolves
const POPULAR_HUBS: Place[] = [
  { place_name: 'DLF Cyber City', state_name: 'Gurugram, Haryana', lat: 28.4952, lng: 77.0891, latitude: 28.4952, longitude: 77.0891 },
  { place_name: 'Connaught Place', state_name: 'New Delhi, Delhi', lat: 28.6315, lng: 77.2167, latitude: 28.6315, longitude: 77.2167 },
  { place_name: 'Indira Gandhi International Airport (DEL)', state_name: 'New Delhi, Delhi', lat: 28.5562, lng: 77.1000, latitude: 28.5562, longitude: 77.1000 },
  { place_name: 'Noida Sector 62', state_name: 'Noida, Uttar Pradesh', lat: 28.6258, lng: 77.3653, latitude: 28.6258, longitude: 77.3653 },
  { place_name: 'Electronic City', state_name: 'Bengaluru, Karnataka', lat: 12.8399, lng: 77.6770, latitude: 12.8399, longitude: 77.6770 },
  { place_name: 'Whitefield', state_name: 'Bengaluru, Karnataka', lat: 12.9698, lng: 77.7500, latitude: 12.9698, longitude: 77.7500 },
  { place_name: 'Bandra Kurla Complex (BKC)', state_name: 'Mumbai, Maharashtra', lat: 19.0662, lng: 72.8687, latitude: 19.0662, longitude: 72.8687 },
  { place_name: 'Hitec City', state_name: 'Hyderabad, Telangana', lat: 17.4474, lng: 78.3762, latitude: 17.4474, longitude: 78.3762 },
  { place_name: 'Magarpatta City', state_name: 'Pune, Maharashtra', lat: 18.5158, lng: 73.9272, latitude: 18.5158, longitude: 73.9272 },
  { place_name: 'Hinjawadi IT Park', state_name: 'Pune, Maharashtra', lat: 18.5913, lng: 73.7389, latitude: 18.5913, longitude: 73.7389 },
];

function findLocalMatches(q: string): Place[] {
  const norm = q.toLowerCase();
  return POPULAR_HUBS.filter(
    (h) => h.place_name.toLowerCase().includes(norm) || (h.state_name && h.state_name.toLowerCase().includes(norm))
  );
}

/**
 * Nudge the backend awake on screen mount.
 */
export function warmUp(): void {
  apiFetch('/health', {}, { timeoutMs: 15000, retries: 0 }).catch(() => {});
}

export async function searchPlaces(query: string, attempt = 0): Promise<GeoOutcome> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return { status: 'idle' };

  const cacheKey = q.toLowerCase();
  const cached = clientGeoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CLIENT_CACHE_TTL_MS) {
    return { status: 'ok', places: cached.places };
  }

  try {
    const res = await apiFetch(
      `/api/geo/search?query=${encodeURIComponent(q)}`,
      {},
      { timeoutMs: 12000, retries: 1 }
    );

    if (!res.ok) {
      const local = findLocalMatches(q);
      if (local.length > 0) return { status: 'ok', places: local };

      return {
        status: 'error',
        message: res.status === 401
          ? 'Not signed in yet — try again in a moment.'
          // The place search has its own tighter limit (it is billed per
          // call). Blaming the connection would send people to fix the wrong
          // thing.
          : res.status === 429
            ? 'Too many searches just now — wait a few seconds and try again.'
            : 'Could not load places. Check your connection.',
      };
    }

    const data = await res.json();
    const serverPlaces: Place[] = data.results || data.suggestions || (Array.isArray(data) ? data : []);

    // Merge with any matching prominent local landmarks
    const local = findLocalMatches(q);
    const combined = [...serverPlaces];
    for (const l of local) {
      if (!combined.some((p) => p.place_name.toLowerCase() === l.place_name.toLowerCase())) {
        combined.push(l);
      }
    }

    if (combined.length > 0) {
      clientGeoCache.set(cacheKey, { at: Date.now(), places: combined });
    }

    return { status: 'ok', places: combined };
  } catch {
    const local = findLocalMatches(q);
    if (local.length > 0) {
      return { status: 'ok', places: local };
    }

    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 400));
      return searchPlaces(query, attempt + 1);
    }
    return { status: 'error', message: 'Could not load places. Check your connection.' };
  }
}

/**
 * Google Maps turn-by-turn link for a driver: origin is the phone's current
 * location (Maps fills it in), every pickup stop is queued as a waypoint in
 * the order the driver listed them, and the ride's end is the destination.
 * Maps opens the native app when installed and the web otherwise.
 */
export function buildNavigationUrl(ride: {
  route_geojson?: { coordinates?: unknown };
  pickup_points?: Array<{ lat?: number; lng?: number }>;
}): string | null {
  const coords = Array.isArray(ride?.route_geojson?.coordinates) ? (ride.route_geojson!.coordinates as any[]) : [];
  const end = coords[coords.length - 1];
  if (!Array.isArray(end) || !Number.isFinite(Number(end[0])) || !Number.isFinite(Number(end[1]))) return null;
  const fmt = (lat: number, lng: number) => `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  const stops = (Array.isArray(ride.pickup_points) ? ride.pickup_points : [])
    .filter((p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)))
    .slice(0, 9) // Google Maps accepts at most 9 waypoints in a URL.
    .map((p) => fmt(Number(p.lat), Number(p.lng)));
  const params = [
    'api=1',
    `destination=${encodeURIComponent(fmt(Number(end[1]), Number(end[0])))}`,
    'travelmode=driving',
    'dir_action=navigate',
  ];
  if (stops.length) params.push(`waypoints=${encodeURIComponent(stops.join('|'))}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}
