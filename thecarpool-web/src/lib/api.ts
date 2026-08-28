import { auth } from './firebase';

/**
 * Drop-in replacement for `fetch` for calls to the TheCarPool backend.
 *
 * Attaches the current user's Firebase ID token as a Bearer token so the
 * backend's requireAuth middleware (admin.auth().verifyIdToken) can identify
 * the caller. Use this for every `/api/*` request that hits a protected route.
 */
/**
 * Resolve the signed-in user once Firebase has restored its persisted session.
 *
 * `auth.currentUser` is null on a fresh page load until that restore finishes,
 * so a request fired in that window went out with no Authorization header at
 * all and the backend 401'd. Resolves as soon as the state is known — with the
 * user, or with null when nobody is signed in — and gives up after a timeout
 * rather than hanging a request forever.
 */
function waitForAuth(timeoutMs = 3000): Promise<(typeof auth)['currentUser']> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (u: (typeof auth)['currentUser']) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(u);
    };
    const timer = setTimeout(() => finish(auth.currentUser), timeoutMs);
    const unsubscribe = auth.onAuthStateChanged((u) => finish(u));
  });
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});

  const user = auth.currentUser ?? (await waitForAuth());
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Default JSON content-type for requests that carry a body.
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(input, { ...init, headers });
}
