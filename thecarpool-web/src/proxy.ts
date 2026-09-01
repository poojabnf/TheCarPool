import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'thecarpool-fe636';

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
  if (pathname.startsWith('/admin') && claims.admin !== true && claims.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/customer', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/customer/:path*', '/partner/:path*', '/admin/:path*'],
};
