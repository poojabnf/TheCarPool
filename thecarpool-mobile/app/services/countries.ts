/**
 * Country dial codes for the phone sign-in flow.
 *
 * The app previously hardcoded +91, which made it impossible for anyone
 * outside India to create an account at all. This list is deliberately
 * small — the markets we actually intend to serve — rather than all ~250
 * ISO countries: a shorter picker is quicker to scan, and adding a market
 * is a one-line change.
 *
 * `nsnLength` is the National Significant Number length, i.e. the digits
 * AFTER the dial code. It drives both input `maxLength` and the enable
 * condition on the Continue button. Where a country genuinely has variable
 * lengths (most of Europe), a [min, max] range is used instead of a fixed
 * count, so we neither truncate a valid number nor accept an obviously
 * short one.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, used as the stable key. */
  code: string;
  name: string;
  /** E.164 country calling code, without the leading '+'. */
  dial: string;
  flag: string;
  /** Digits after the dial code: a fixed length, or [min, max]. */
  nsnLength: number | [number, number];
}

export const COUNTRIES: Country[] = [
  // India — the launch market, kept first so it stays the default.
  { code: 'IN', name: 'India', dial: '91', flag: '🇮🇳', nsnLength: 10 },

  // North America — NANP, uniformly 10 digits.
  { code: 'US', name: 'United States', dial: '1', flag: '🇺🇸', nsnLength: 10 },
  { code: 'CA', name: 'Canada', dial: '1', flag: '🇨🇦', nsnLength: 10 },

  // Europe / UK.
  { code: 'GB', name: 'United Kingdom', dial: '44', flag: '🇬🇧', nsnLength: 10 },
  { code: 'IE', name: 'Ireland', dial: '353', flag: '🇮🇪', nsnLength: [7, 9] },
  { code: 'DE', name: 'Germany', dial: '49', flag: '🇩🇪', nsnLength: [10, 11] },
  { code: 'FR', name: 'France', dial: '33', flag: '🇫🇷', nsnLength: 9 },
  { code: 'ES', name: 'Spain', dial: '34', flag: '🇪🇸', nsnLength: 9 },
  { code: 'IT', name: 'Italy', dial: '39', flag: '🇮🇹', nsnLength: [9, 10] },
  { code: 'NL', name: 'Netherlands', dial: '31', flag: '🇳🇱', nsnLength: 9 },
  { code: 'PL', name: 'Poland', dial: '48', flag: '🇵🇱', nsnLength: 9 },
  { code: 'SE', name: 'Sweden', dial: '46', flag: '🇸🇪', nsnLength: [7, 9] },

  // Middle East.
  { code: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪', nsnLength: 9 },
  { code: 'SA', name: 'Saudi Arabia', dial: '966', flag: '🇸🇦', nsnLength: 9 },
  { code: 'QA', name: 'Qatar', dial: '974', flag: '🇶🇦', nsnLength: 8 },
  { code: 'KW', name: 'Kuwait', dial: '965', flag: '🇰🇼', nsnLength: 8 },
  { code: 'BH', name: 'Bahrain', dial: '973', flag: '🇧🇭', nsnLength: 8 },
  { code: 'OM', name: 'Oman', dial: '968', flag: '🇴🇲', nsnLength: 8 },

  // South-East Asia / APAC.
  { code: 'SG', name: 'Singapore', dial: '65', flag: '🇸🇬', nsnLength: 8 },
  { code: 'MY', name: 'Malaysia', dial: '60', flag: '🇲🇾', nsnLength: [9, 10] },
  { code: 'ID', name: 'Indonesia', dial: '62', flag: '🇮🇩', nsnLength: [9, 12] },
  { code: 'PH', name: 'Philippines', dial: '63', flag: '🇵🇭', nsnLength: 10 },
  { code: 'TH', name: 'Thailand', dial: '66', flag: '🇹🇭', nsnLength: 9 },
  { code: 'VN', name: 'Vietnam', dial: '84', flag: '🇻🇳', nsnLength: 9 },
  { code: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺', nsnLength: 9 },
  { code: 'NZ', name: 'New Zealand', dial: '64', flag: '🇳🇿', nsnLength: [8, 9] },
];

/** India stays the default so existing users see no change. */
export const DEFAULT_COUNTRY: Country =
  COUNTRIES.find((c) => c.code === 'IN') ?? COUNTRIES[0];

export function findCountry(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? DEFAULT_COUNTRY;
}

/** Longest number the country accepts — drives TextInput maxLength. */
export function maxDigits(country: Country): number {
  return Array.isArray(country.nsnLength) ? country.nsnLength[1] : country.nsnLength;
}

/** Whether a national number is a plausible length for this country. */
export function isValidNsn(country: Country, nsn: string): boolean {
  const digits = nsn.replace(/\D/g, '');
  if (Array.isArray(country.nsnLength)) {
    const [min, max] = country.nsnLength;
    return digits.length >= min && digits.length <= max;
  }
  return digits.length === country.nsnLength;
}

/**
 * Build the E.164 number Firebase expects (`+<dial><nsn>`).
 *
 * Leading zeros are stripped: people habitually write the trunk prefix
 * ("07700 900123" in the UK, "0412 345 678" in Australia) but E.164 has no
 * place for it, and passing it through yields an invalid-number error that
 * reads as "our app is broken" rather than "drop the 0".
 */
export function toE164(country: Country, nsn: string): string {
  const digits = nsn.replace(/\D/g, '').replace(/^0+/, '');
  return `+${country.dial}${digits}`;
}
