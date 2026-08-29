/**
 * Metro-region mapping for wide-area ride search.
 *
 * Carpooling in Indian metros crosses city boundaries daily —
 * a ride posted as "Delhi NCR" should match a rider searching from
 * Noida, Gurugram, or Ghaziabad. This module maps sub-city names
 * to their enclosing metro region and provides a bounding box so
 * the search endpoint can expand discovery beyond the strict 1.5 km
 * coordinate radius.
 *
 * Adding a new metro is just one more entry in METRO_REGIONS.
 */

export interface MetroRegion {
  /** Display name shown to riders, e.g. "Delhi NCR" */
  name: string;
  /**
   * Lowercase city / area names that belong to this metro.
   * Used for fuzzy text matching against ride source/destination.
   */
  cities: string[];
  /** Bounding box enclosing the entire metro (generous padding). */
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

// ─── Metro Definitions ──────────────────────────────────────────────────────

export const METRO_REGIONS: MetroRegion[] = [
  {
    name: 'Delhi NCR',
    cities: [
      'delhi', 'new delhi', 'ncr', 'delhi ncr',
      'noida', 'greater noida', 'noida extension',
      'gurugram', 'gurgaon', 'manesar',
      'faridabad', 'ballabgarh',
      'ghaziabad', 'indirapuram', 'vaishali', 'vasundhara',
      'bahadurgarh', 'sonipat', 'kundli',
      'dwarka', 'rohini', 'saket', 'lajpat nagar', 'connaught place',
      'rajiv chowk', 'nehru place', 'okhla', 'jasola',
      'sector 62', 'sector 63', 'sector 18', 'sector 16',
      'dlf cyber city', 'dlf phase', 'sohna road', 'golf course road',
      'igi airport', 'indira gandhi international airport',
    ],
    bbox: { minLat: 28.10, maxLat: 29.05, minLng: 76.70, maxLng: 77.65 },
  },
  {
    name: 'Mumbai MMR',
    cities: [
      'mumbai', 'bombay',
      'navi mumbai', 'new mumbai',
      'thane', 'kalyan', 'dombivli', 'dombivali',
      'mira-bhayandar', 'mira bhayandar', 'mira road',
      'vasai', 'virar', 'vasai-virar',
      'panvel', 'kharghar', 'vashi', 'belapur', 'nerul',
      'andheri', 'bandra', 'dadar', 'goregaon', 'malad',
      'borivali', 'kandivali', 'jogeshwari',
      'powai', 'vikhroli', 'ghatkopar', 'mulund',
      'bkc', 'bandra kurla complex',
      'lower parel', 'worli', 'nariman point',
      'chhatrapati shivaji maharaj international airport',
    ],
    bbox: { minLat: 18.85, maxLat: 19.65, minLng: 72.70, maxLng: 73.25 },
  },
  {
    name: 'Bengaluru',
    cities: [
      'bengaluru', 'bangalore', 'blr',
      'electronic city', 'whitefield', 'marathahalli',
      'yelahanka', 'hebbal', 'kr puram', 'kr pura',
      'sarjapur', 'sarjapura', 'bellandur', 'hsr layout',
      'koramangala', 'indiranagar', 'jayanagar',
      'jp nagar', 'banashankari', 'rajajinagar',
      'mg road', 'brigade road', 'ub city',
      'devanahalli', 'kempegowda international airport',
      'manyata tech park', 'outer ring road',
      'anekal', 'hosur road', 'bannerghatta',
    ],
    bbox: { minLat: 12.70, maxLat: 13.25, minLng: 77.35, maxLng: 77.85 },
  },
  {
    name: 'Hyderabad',
    cities: [
      'hyderabad', 'hyd',
      'secunderabad', 'shamshabad',
      'hitec city', 'hitech city', 'madhapur',
      'gachibowli', 'kondapur', 'kukatpally',
      'begumpet', 'ameerpet', 'jubilee hills', 'banjara hills',
      'lb nagar', 'dilsukhnagar', 'uppal',
      'miyapur', 'lingampally',
      'rajiv gandhi international airport',
      'cyberabad', 'financial district',
    ],
    bbox: { minLat: 17.15, maxLat: 17.65, minLng: 78.20, maxLng: 78.70 },
  },
  {
    name: 'Chennai',
    cities: [
      'chennai', 'madras',
      'tambaram', 'avadi', 'ambattur', 'porur',
      'adyar', 'velachery', 'guindy', 't nagar', 'anna nagar',
      'sholinganallur', 'omr', 'ecr', 'perungudi',
      'chromepet', 'pallavaram', 'medavakkam',
      'mahabalipuram', 'kelambakkam',
      'chennai international airport',
      'tidel park', 'sipcot it park',
    ],
    bbox: { minLat: 12.75, maxLat: 13.30, minLng: 79.95, maxLng: 80.35 },
  },
  {
    name: 'Pune',
    cities: [
      'pune', 'poona',
      'pimpri-chinchwad', 'pimpri chinchwad', 'pimpri', 'chinchwad',
      'hinjawadi', 'hinjewadi', 'wakad', 'baner',
      'kharadi', 'magarpatta', 'hadapsar',
      'viman nagar', 'kalyani nagar', 'koregaon park',
      'shivaji nagar', 'deccan',
      'kothrud', 'karve nagar', 'warje',
      'pune airport', 'lohegaon',
      'talegaon', 'chakan', 'lonavala',
    ],
    bbox: { minLat: 18.35, maxLat: 18.75, minLng: 73.55, maxLng: 74.05 },
  },
  {
    name: 'Kolkata',
    cities: [
      'kolkata', 'calcutta',
      'howrah', 'salt lake', 'salt lake city',
      'rajarhat', 'new town', 'newtown',
      'dum dum', 'barasat', 'barrackpore',
      'park street', 'esplanade', 'sealdah',
      'jadavpur', 'garia', 'behala',
      'bidhan nagar', 'sector v',
      'netaji subhas chandra bose international airport',
    ],
    bbox: { minLat: 22.35, maxLat: 22.80, minLng: 88.15, maxLng: 88.60 },
  },
  {
    name: 'Ahmedabad',
    cities: [
      'ahmedabad', 'amdavad',
      'gandhinagar', 'gift city',
      'sanand', 'bopal', 'sg highway',
      'prahlad nagar', 'satellite', 'vastrapur',
      'maninagar', 'naroda', 'vastral',
      'sardar vallabhbhai patel international airport',
    ],
    bbox: { minLat: 22.85, maxLat: 23.35, minLng: 72.30, maxLng: 72.80 },
  },
  {
    name: 'Jaipur',
    cities: [
      'jaipur', 'pink city',
      'mansarovar', 'vaishali nagar', 'malviya nagar',
      'sitapura', 'sanganer', 'tonk road',
      'jaipur international airport',
    ],
    bbox: { minLat: 26.70, maxLat: 27.05, minLng: 75.60, maxLng: 76.00 },
  },
  {
    name: 'Lucknow',
    cities: [
      'lucknow',
      'gomti nagar', 'hazratganj', 'indira nagar',
      'amausi', 'alambagh', 'charbagh',
      'chaudhary charan singh international airport',
    ],
    bbox: { minLat: 26.70, maxLat: 27.00, minLng: 80.80, maxLng: 81.15 },
  },
];

// ─── Lookup Helpers ─────────────────────────────────────────────────────────

/**
 * Build a flat Map<lowercase city → MetroRegion> for O(1) lookups.
 * Built once at import time; METRO_REGIONS is static.
 */
const cityIndex = new Map<string, MetroRegion>();
for (const metro of METRO_REGIONS) {
  for (const city of metro.cities) {
    cityIndex.set(city, metro);
  }
}

/**
 * Find the metro region a free-text place name belongs to.
 *
 * Checks whether any token sequence in `text` matches a known city.
 * Returns the MetroRegion or null if the text doesn't match any metro.
 *
 * Examples:
 *   findMetroByText("DLF Cyber City, Gurugram")  → Delhi NCR
 *   findMetroByText("Noida Sector 62")           → Delhi NCR
 *   findMetroByText("Electronic City, Bengaluru") → Bengaluru
 *   findMetroByText("Some random village")        → null
 */
export function findMetroByText(text: string | null | undefined): MetroRegion | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // 1. Direct full-text match
  const direct = cityIndex.get(lower);
  if (direct) return direct;

  // 2. Check if any known city name appears as a substring
  for (const [city, metro] of cityIndex) {
    // Only match substrings at word boundaries to avoid false positives
    if (city.length < 3) continue; // skip very short tokens
    if (lower.includes(city)) {
      // Verify it's at a word boundary (not a substring of a longer word)
      const idx = lower.indexOf(city);
      const before = idx === 0 || /[\s,.\-/()]/.test(lower[idx - 1]);
      const after = idx + city.length >= lower.length || /[\s,.\-/()]/.test(lower[idx + city.length]);
      if (before && after) return metro;
    }
  }

  return null;
}

/**
 * Find the metro region a coordinate falls within.
 *
 * Uses the bounding box — generous enough to cover the whole metro.
 */
export function findMetroByCoords(lat: number, lng: number): MetroRegion | null {
  for (const metro of METRO_REGIONS) {
    if (
      lat >= metro.bbox.minLat && lat <= metro.bbox.maxLat &&
      lng >= metro.bbox.minLng && lng <= metro.bbox.maxLng
    ) {
      return metro;
    }
  }
  return null;
}

/**
 * Check whether two places are in the SAME metro region.
 *
 * Returns the shared MetroRegion if both belong to the same one, null otherwise.
 */
export function sameMetro(
  textA: string | null | undefined,
  textB: string | null | undefined
): MetroRegion | null {
  const metroA = findMetroByText(textA);
  const metroB = findMetroByText(textB);
  if (metroA && metroB && metroA.name === metroB.name) return metroA;
  return null;
}

/**
 * Check whether a coordinate is inside a metro's bounding box.
 */
export function coordInMetroBbox(lat: number, lng: number, metro: MetroRegion): boolean {
  return (
    lat >= metro.bbox.minLat && lat <= metro.bbox.maxLat &&
    lng >= metro.bbox.minLng && lng <= metro.bbox.maxLng
  );
}
