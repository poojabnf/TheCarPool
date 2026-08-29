/**
 * API configuration & authenticated fetch helper.
 * ─────────────────────────────────────────────────────
 * The backend base URL is read from the EXPO_PUBLIC_API_URL env var so the
 * app talks to localhost in development and the real backend in production
 * builds. Set it in eas.json (per-profile `env`) or a local .env file.
 *
 * NOTE: localhost only works in a simulator. On a physical device use your
 * machine's LAN IP (e.g. http://192.168.1.5:5000) or the deployed URL.
 */
import { auth } from './firebase';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';

/**
 * fetch wrapper that attaches the current user's Firebase ID token so the
 * backend's requireAuth middleware can authenticate the request,
 * with built-in timeout (default 10s) and retry logic (default 2 retries).
 */
/**
 * Resolve the signed-in user once Firebase has restored its persisted session.
 *
 * Resolves as soon as onAuthStateChanged fires — with the user, or with null
 * when nobody is signed in. The timeout is a backstop so a request can never
 * hang here: falling through unauthenticated is worse than a 401, but hanging
 * forever is worse still.
 */
function waitForAuth(timeoutMs = 3000): Promise<ReturnType<typeof auth>['currentUser']> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (u: ReturnType<typeof auth>['currentUser']) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(u);
    };
    const timer = setTimeout(() => finish(auth().currentUser), timeoutMs);
    const unsubscribe = auth().onAuthStateChanged((u) => finish(u));
  });
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const { timeoutMs = 15000, retries = 2 } = options;
  const headers = new Headers(init.headers || {});

  // On a cold start `currentUser` is null until Firebase restores the persisted
  // session. Firing immediately sends no Authorization header at all, and the
  // backend 401s — which surfaced as silently empty location suggestions rather
  // than any visible error. Wait briefly for auth to settle first.
  const user = auth().currentUser ?? (await waitForAuth());
  if (user) {
    try {
      const token = await user.getIdToken(false);
      headers.set('Authorization', `Bearer ${token}`);
    } catch {
      try {
        const token = await user.getIdToken(true);
        headers.set('Authorization', `Bearer ${token}`);
      } catch {}
    }
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const url = path.startsWith('http') ? path : `${API_URL}${path}`;

  let attempt = 0;
  while (true) {
    attempt++;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      clearTimeout(id);

      // If token expired (401) on initial attempt, refresh token and retry
      if (res.status === 401 && attempt === 1 && user) {
        try {
          const freshToken = await user.getIdToken(true);
          headers.set('Authorization', `Bearer ${freshToken}`);
          continue;
        } catch {}
      }

      // If it is a transient server error (502, 503, 504) and we have retries left
      if (res.status >= 502 && res.status <= 504 && attempt <= retries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }

      return res;
    } catch (err: any) {
      clearTimeout(id);

      // If it is a network error or abort, and we have retries left, retry
      if (attempt <= retries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      throw err;
    }
  }
}
