import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';

/**
 * Server-side route guard for TheCarPool (Next.js 16 proxy) — GAP-S02/F08.
 *
 * AuthContext mirrors the user's Firebase ID token into a `__session` cookie
 * (kept fresh via onIdTokenChanged). Here we cryptographically verify that
 * token at the edge against Google's public JWKS (issuer + audience checks)
 * before serving protected page HTML, so client-side-only bypasses, forged
 * cookies, and expired sessions are all rejected server-side.
 *
 * The backend separately re-verifies every API call with the Admin SDK — this
 * guard protects the page shell; the API guard protects the data.
 */

const FIREBASE_PROJECT_ID = 'thecarpool-fe636';

// Google's public signing keys for Firebase ID tokens. jose caches the JWKS
// and refreshes it automatically across invocations.
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com')
);

async function verifySession(token: string | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const claims = await verifySession(request.cookies.get('__session')?.value);

  if (!claims) {
    // Not signed in, expired, or forged — back to the landing page.
    const loginUrl = new URL('/', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // The admin area additionally requires the `admin` custom claim.
  if (pathname.startsWith('/admin') && claims.admin !== true) {
    return NextResponse.redirect(new URL('/customer', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/customer/:path*', '/partner/:path*', '/admin/:path*'],
};
