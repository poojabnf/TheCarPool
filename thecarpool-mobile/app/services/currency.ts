/**
 * Money formatting.
 * ─────────────────────────────────────────────────────
 * Every screen used to hardcode a `₹` and hand-roll `.toFixed(2)`, which
 * baked the launch market into the UI: a US rider would have seen "₹12.00"
 * for a dollar fare. Amounts now render through `formatMoney`, which takes
 * the currency from the wallet/ride rather than assuming one.
 *
 * A zustand store (mirroring i18n.ts) holds the active currency so a change
 * re-renders the screens showing money. It ships via OTA — no native module.
 *
 * Amounts are always MAJOR units (rupees, dollars), never minor/paise. The
 * backend already stores them that way; only the Razorpay boundary converts
 * to paise, and it does that conversion itself.
 */
import { create } from 'zustand';

/** ISO 4217 code, e.g. 'INR', 'USD', 'AED'. */
export type CurrencyCode = string;

/**
 * Locale used for grouping and separators. Kept separate from the currency:
 * they are genuinely independent (a UK user may hold a EUR balance), and
 * conflating them is what produces "€1,234.56" for someone who expects
 * "€1.234,56".
 */
const DEFAULT_LOCALE_FOR: Record<string, string> = {
  INR: 'en-IN', // lakh/crore grouping — 1,23,456.78 rather than 123,456.78
  USD: 'en-US',
  CAD: 'en-CA',
  GBP: 'en-GB',
  EUR: 'en-IE',
  AED: 'en-AE',
  SAR: 'en-SA',
  SGD: 'en-SG',
  MYR: 'en-MY',
  AUD: 'en-AU',
  NZD: 'en-NZ',
};

/** Fallback symbols for the rare runtime without full Intl currency data. */
const SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', CAD: 'CA$', GBP: '£', EUR: '€',
  AED: 'AED ', SAR: 'SAR ', SGD: 'S$', MYR: 'RM', AUD: 'A$', NZD: 'NZ$',
};

interface CurrencyState {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  // India remains the default so existing users see no change until the
  // backend tells us otherwise (wallet and ride payloads carry `currency`).
  currency: 'INR',
  setCurrency: (currency) => set({ currency }),
}));

export interface FormatOptions {
  /** Override the store's currency — use when a ride/wallet carries its own. */
  currency?: CurrencyCode;
  /** Force decimal places. Defaults to 0 for whole amounts, 2 otherwise. */
  decimals?: number;
}

/**
 * Format an amount for display, e.g. `formatMoney(1234.5)` → "₹1,234.50".
 *
 * Decimals default to "2 unless the amount is whole", which matches how the
 * screens already behaved — fares showed as ₹180, wallet balances as ₹180.00
 * — so adopting this does not silently restyle every existing number.
 */
export function formatMoney(amount: number, opts: FormatOptions = {}): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const currency = opts.currency || useCurrencyStore.getState().currency;
  const decimals = opts.decimals ?? (Number.isInteger(value) ? 0 : 2);
  const locale = DEFAULT_LOCALE_FOR[currency] || 'en-US';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    // Hermes without full-ICU, or an unknown code: keep it readable rather
    // than throwing inside a render.
    const symbol = SYMBOLS[currency] ?? `${currency} `;
    return `${symbol}${value.toFixed(decimals)}`;
  }
}

/** Just the symbol, for standalone glyphs like the wallet's amount-entry prefix. */
export function currencySymbol(currency?: CurrencyCode): string {
  const code = currency || useCurrencyStore.getState().currency;
  if (SYMBOLS[code]) return SYMBOLS[code].trim();
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE_FOR[code] || 'en-US', {
      style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/** Hook: re-renders the caller when the active currency changes. */
export function useCurrency() {
  const currency = useCurrencyStore((s) => s.currency);
  const setCurrency = useCurrencyStore((s) => s.setCurrency);
  return { currency, setCurrency, formatMoney, currencySymbol };
}
