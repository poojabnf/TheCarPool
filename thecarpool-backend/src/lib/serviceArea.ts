/**
 * Where TheCarPool operates.
 *
 * Place search used to pass `regionCode: 'IN'` to Google, which only BIASES
 * results towards India — it does not restrict them. Typing "New York" still
 * returned New York, and a driver could offer a ride from Jhansi to Manhattan.
 * Nothing downstream could cope with that: the fare comes from a distance the
 * pricing model never anticipated, and Razorpay settles INR only.
 *
 * This module is the single definition of the serviceable area, applied in two
 * layers, because neither is sufficient alone:
 *
 *   1. A bounding box sent to Google, so out-of-area places are mostly never
 *      returned and we do not pay to rank them.
 *   2. A check on the country in each result, because a bounding box is a
 *      rectangle and the countries near India's corners (Pakistan, Nepal,
 *      Bangladesh, Sri Lanka, Myanmar, China) fall inside it.
 *
 * Set SERVICE_COUNTRY to move or widen this. It is deliberately a country and
 * not a free-form list: fares, payouts and insurance all assume one currency
 * and one set of payment rails.
 */

export interface CountryArea {
  /** ISO 3166-1 alpha-2. */
  iso: string;
  /** Human name, as Google renders it at the end of a formatted address. */
  name: string;
  /** Rectangle covering the country, for the Places location restriction. */
  bounds: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } };
}

const AREAS: Record<string, CountryArea> = {
  IN: {
    iso: 'IN',
    name: 'India',
    // Kanyakumari/Indira Point in the south to the Kashmir border in the
    // north; Gujarat coast to Arunachal Pradesh. Generous on purpose — the
    // country check below is what makes it exact.
    bounds: {
      low: { latitude: 6.0, longitude: 68.0 },
      high: { latitude: 37.6, longitude: 97.5 },
    },
  },
};

export function serviceArea(): CountryArea {
  const iso = (process.env.SERVICE_COUNTRY || 'IN').trim().toUpperCase();
  return AREAS[iso] ?? AREAS.IN;
}

/**
 * Does this address sit in the serviceable country?
 *
 * Google's formattedAddress ends with the country name, so that is what is
 * checked. A result with no address at all is REJECTED rather than allowed:
 * letting unknowns through is what a bounding box already does, and this
 * layer exists precisely to catch what the box lets slip.
 */
export function isInServiceArea(address: string | null | undefined): boolean {
  const area = serviceArea();
  const text = String(address ?? '').trim();
  if (!text) return false;
  return new RegExp(`(^|,)\\s*${area.name}\\s*$`, 'i').test(text);
}

/** Is this coordinate inside the service bounding box? */
export function isInServiceBounds(lat: number, lng: number): boolean {
  const { bounds } = serviceArea();
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= bounds.low.latitude && lat <= bounds.high.latitude &&
    lng >= bounds.low.longitude && lng <= bounds.high.longitude
  );
}

/** Message shown when someone searches for somewhere we do not serve. */
export function outOfAreaMessage(): string {
  return `TheCarPool currently operates in ${serviceArea().name} only.`;
}
