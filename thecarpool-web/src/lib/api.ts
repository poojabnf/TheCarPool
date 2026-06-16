import { auth } from './firebase';

/**
 * Drop-in replacement for `fetch` for calls to the TheCarPool backend.
 *
 * Attaches the current user's Firebase ID token as a Bearer token so the
 * backend's requireAuth middleware (admin.auth().verifyIdToken) can identify
 * the caller. Use this for every `/api/*` request that hits a protected route.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});

  const user = auth.currentUser;
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
