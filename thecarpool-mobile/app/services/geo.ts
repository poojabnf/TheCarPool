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

/**
 * Nudge the backend awake.
 *
 * Cloud Run runs at min-instances=0, so after an idle spell the first request
 * pays a ~4-10s cold start. Typing a place name was that first request, and it
 * frequently timed out — the user saw "Could not load places" on a perfectly
 * good connection. Calling this when a screen with a location field opens gives
 * the container a head start while they're still typing.
 *
 * Deliberately fire-and-forget: nothing waits on it and a failure is silent,
 * since it is only ever an optimisation.
 */
export function warmUp(): void {
  apiFetch('/health', {}, { timeoutMs: 20000, retries: 0 }).catch(() => {});
}

export async function searchPlaces(query: string, attempt = 0): Promise<GeoOutcome> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return { status: 'idle' };

  try {
    // 25s, above apiFetch's 15s default: if warmUp() hasn't finished, this
    // request wears the cold start itself, and giving up at 15s turned a slow
    // container into a bogus "check your connection".
    const res = await apiFetch(
      `/api/geo/search?query=${encodeURIComponent(q)}`,
      {},
      { timeoutMs: 25000 }
    );
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
    // The backend sleeps when idle and takes ~9s to wake. A lookup that lands
    // in that window fails once and then succeeds, so retry before blaming the
    // user's connection — reporting a network error for a waking server is
    // both wrong and unactionable.
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 1200));
      return searchPlaces(query, attempt + 1);
    }
    return { status: 'error', message: 'Could not load places. Check your connection.' };
  }
}
