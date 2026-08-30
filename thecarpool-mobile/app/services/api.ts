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

/**
 * Backend base URL.
 *
 * The fallback is the PRODUCTION url, not localhost, and that distinction is
 * the difference between a working app and a dead one.
 *
 * EXPO_PUBLIC_* variables are inlined at bundle time from the eas.json build
 * profile — but only by `eas build`. `eas update` does not read that profile,
 * so every over-the-air bundle was built with EXPO_PUBLIC_API_URL undefined
 * and fell through to http://localhost:5000. Every authenticated request then
 * failed instantly against a server that does not exist on the phone, the
 * callers swallowed the network error, and the app rendered empty everywhere:
 * no name, no rides, no trips, zero earnings. A store build worked; the next
 * OTA broke it. That was the pattern all along.
 *
 * Keying the fallback off __DEV__ removes the whole class of failure: a
 * development bundle still talks to localhost, and a shipped bundle can never
 * point anywhere but production, whether it arrived in a binary or over the
 * air. EXPO_PUBLIC_API_URL still overrides both when it is actually set.
 */
const PRODUCTION_API_URL = 'https://thecarpool-backend-953521578640.asia-south1.run.app';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? 'http://localhost:5000' : PRODUCTION_API_URL);

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
let cachedToken: { token: string; expiresAt: number } | null = null;

function waitForAuth(timeoutMs = 1500): Promise<ReturnType<typeof auth>['currentUser']> {
  const current = auth().currentUser;
  if (current) return Promise.resolve(current);
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

  const user = auth().currentUser ?? (await waitForAuth());
  if (user) {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now + 60000) {
      headers.set('Authorization', `Bearer ${cachedToken.token}`);
    } else {
      try {
        const token = await user.getIdToken(false);
        cachedToken = { token, expiresAt: now + 50 * 60 * 1000 };
        headers.set('Authorization', `Bearer ${token}`);
      } catch {
        try {
          const token = await user.getIdToken(true);
          cachedToken = { token, expiresAt: now + 50 * 60 * 1000 };
          headers.set('Authorization', `Bearer ${token}`);
        } catch {}
      }
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
