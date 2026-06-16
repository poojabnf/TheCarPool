"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Client-side Sentry initialisation, guarded by env so it's a no-op without
// a DSN. We intentionally init at runtime (not via the build-time webpack
// plugin) to keep the Next build untouched.
let initialised = false;

export default function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn || initialised) return;
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
    initialised = true;
  }, []);

  return null;
}
