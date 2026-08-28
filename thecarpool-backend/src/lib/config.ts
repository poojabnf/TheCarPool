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

// Secrets the server cannot function without in production. NOTE:
// FIREBASE_SERVICE_ACCOUNT_KEY is intentionally NOT here — on GCP (Cloud Run)
// firebase-admin authenticates via Application Default Credentials (the runtime
// service account), so requiring the env var would crash an otherwise healthy
// deploy. There are currently no hard-required secrets.
const REQUIRED_IN_PROD: readonly string[] = [];

// Optional integrations — absence degrades gracefully, we just warn.
const OPTIONAL = [
  'FIREBASE_SERVICE_ACCOUNT_KEY', // optional: ADC is used when unset
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAYX_ACCOUNT_NUMBER',
  'SENTRY_DSN',
  'GOOGLE_MAPS_API_KEY',
  'REDIS_URL',
  'DEFAULT_CURRENCY',
  'CRON_SECRET',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
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

/**
 * Currency new wallets and orders are denominated in.
 *
 * Was hardcoded to 'INR' in a dozen places, which quietly made the launch
 * market a property of the code. Set DEFAULT_CURRENCY to move a deployment
 * to another market; INR remains the fallback so existing behaviour is
 * unchanged.
 *
 * NOTE: this does NOT make the app multi-currency on its own. Razorpay
 * settles in INR and RazorpayX payouts ride Indian rails (UPI/IMPS), so a
 * non-INR value here needs a payment provider that supports it. The
 * constant exists so the rest of the system stops assuming.
 */
// Both values are read from the environment, which cannot change while the
// process is alive, so they are parsed once. `undefined` means "not computed
// yet" — distinct from a computed value, so a legitimately falsy result is
// still cached rather than re-derived on every call.
let currencyCache: string | undefined;
let originsCache: string[] | true | undefined;

export function defaultCurrency(): string {
  if (currencyCache !== undefined) return currencyCache;
  const raw = process.env.DEFAULT_CURRENCY?.trim().toUpperCase();
  currencyCache = raw && /^[A-Z]{3}$/.test(raw) ? raw : 'INR';
  return currencyCache;
}

/** Comma-separated allowlist of web origins permitted for CORS / Socket.IO. */
export function allowedOrigins(): string[] | true {
  if (originsCache !== undefined) return originsCache;
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  // Default to permissive in development so localhost tooling keeps working.
  if (!raw) originsCache = process.env.NODE_ENV === 'production' ? [] : true;
  else if (raw === '*') originsCache = true;
  else originsCache = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return originsCache;
}

/** Tests mutate process.env between cases; let them start clean. */
export function __resetConfigCache(): void {
  currencyCache = undefined;
  originsCache = undefined;
}
