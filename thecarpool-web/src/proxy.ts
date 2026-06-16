import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Renamed from middleware.ts → proxy.ts (Next.js 16 deprecated the
// `middleware` file convention in favour of `proxy`).
export function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/customer/:path*',
    '/partner/:path*',
    '/admin/:path*',
  ],
};
