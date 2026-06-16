import * as Sentry from '@sentry/node';

// Initialise Sentry only when a DSN is configured, so local/dev runs without
// a DSN are completely unaffected (no-op capture calls).
let enabled = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  });
  enabled = true;
}

export function captureError(err: unknown) {
  if (enabled) Sentry.captureException(err);
}

export const sentryEnabled = () => enabled;
