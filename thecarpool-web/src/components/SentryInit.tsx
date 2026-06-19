'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

let initialised = false;

export default function SentryInit() {
  useEffect(() => {
    if (initialised || !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    initialised = true;
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV,
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    });
  }, []);
  return null;
}

/** Call after Firebase sign-in to attach user context to Sentry reports. */
export function setSentryUser(uid: string, email?: string) {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.setUser({ id: uid, email });
  }
}

/** Call on sign-out to clear Sentry user context. */
export function clearSentryUser() {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.setUser(null);
  }
}
