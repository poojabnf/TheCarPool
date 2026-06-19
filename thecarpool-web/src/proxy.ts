import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Server-side route guard for TheCarPool (Next.js 16 proxy).
 *
 * Protected paths require the `firebase_authenticated` cookie to be present.
 * This cookie is set by AuthContext after a successful Firebase sign-in and
 * cleared on sign-out. It prevents unauthenticated users from receiving the
 * HTML of protected pages (admin, customer, partner dashboards).
 *
 * NOTE: The cookie is NOT cryptographically verified here — that is enforced
 * by the backend's requireAuth middleware (Firebase Admin verifyIdToken).
 * The purpose of this middleware is to avoid serving protected page HTML to
 * unauthenticated crawlers/users before React hydrates.
 */

const PROTECTED_PREFIXES = ['/customer', '/partner', '/admin'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (!isProtected) return NextResponse.next();

  const isAuthenticated =
    request.cookies.get('firebase_authenticated')?.value === '1';

  if (!isAuthenticated) {
    const loginUrl = new URL('/', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/customer/:path*', '/partner/:path*', '/admin/:path*'],
};
