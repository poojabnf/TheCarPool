/**
 * Place lookup for the location inputs.
 *
 * Both the rider search and the driver's offer form had their own copy of
 * this, and both swallowed every failure into an empty array — so a 401, a
 * dead network and "no such place" all rendered as the same blank dropdown.
 * That made a broken lookup indistinguishable from a genuine no-match, and
 * cost real time to diagnose.
 *
 * This returns the reason as well as the results, so callers can say what
 * went wrong instead of showing nothing.
 */
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

/** Below this we don't search: the backend ignores it and it wastes a round trip. */
export const MIN_QUERY_LENGTH = 3;

export async function searchPlaces(query: string): Promise<GeoOutcome> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return { status: 'idle' };

  try {
    const res = await apiFetch(`/api/geo/search?query=${encodeURIComponent(q)}`);
    if (!res.ok) {
      // 401 here means the request went out before Firebase restored the
      // session. apiFetch now waits for auth, so this should be rare — but
      // say so rather than showing an empty list if it happens.
      return {
        status: 'error',
        message: res.status === 401
          ? 'Not signed in yet — try again in a moment.'
          : 'Could not load places. Check your connection.',
      };
    }
    const data = await res.json();
    const places = data.results || data.suggestions || (Array.isArray(data) ? data : []);
    return { status: 'ok', places };
  } catch {
    return { status: 'error', message: 'Could not load places. Check your connection.' };
  }
}
