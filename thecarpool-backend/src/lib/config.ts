/**
 * Boot-time environment validation.
 *
 * Rather than letting a missing critical secret surface as a confusing runtime
 * error on the first request, we check the essentials at startup. In
 * production a missing hard-requirement aborts the boot; optional integrations
 * (Razorpay, Sentry, Twilio…) only log a warning so the app still runs with
 * those features disabled.
 */

type Logger = { warn: (msg: string) => void; info: (msg: string) => void };

// Secrets the server cannot function without in production.
const REQUIRED_IN_PROD = ['FIREBASE_SERVICE_ACCOUNT_KEY'] as const;

// Optional integrations — absence degrades gracefully, we just warn.
const OPTIONAL = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAYX_ACCOUNT_NUMBER',
  'SENTRY_DSN',
  'GOOGLE_MAPS_API_KEY',
  'REDIS_URL',
] as const;

export function validateEnv(logger?: Logger): void {
  const isProd = process.env.NODE_ENV === 'production';
  const missingRequired = REQUIRED_IN_PROD.filter((k) => !process.env[k]);

  if (missingRequired.length > 0) {
    const msg = `Missing required environment variables: ${missingRequired.join(', ')}`;
    if (isProd) {
      // Fail fast — do not boot a half-configured server in production.
      throw new Error(msg);
    }
    (logger?.warn ?? console.warn)(`${msg} (allowed in non-production)`);
  }

  const missingOptional = OPTIONAL.filter((k) => !process.env[k]);
  if (missingOptional.length > 0) {
    (logger?.warn ?? console.warn)(
      `Optional integrations not configured (features disabled): ${missingOptional.join(', ')}`
    );
  }
}

/** Comma-separated allowlist of web origins permitted for CORS / Socket.IO. */
export function allowedOrigins(): string[] | true {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  // Default to permissive in development so localhost tooling keeps working.
  if (!raw) return process.env.NODE_ENV === 'production' ? [] : true;
  if (raw === '*') return true;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}
