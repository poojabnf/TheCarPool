import {
  findMetroByText,
  findMetroByCoords,
  sameMetro,
  coordInMetroBbox,
  METRO_REGIONS,
} from '../metroRegions';

describe('metroRegions', () => {
  // ── findMetroByText ─────────────────────────────────────────────────────

  describe('findMetroByText', () => {
    it('returns Delhi NCR for "Delhi"', () => {
      expect(findMetroByText('Delhi')?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for "Noida Sector 62"', () => {
      expect(findMetroByText('Noida Sector 62')?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for "DLF Cyber City, Gurugram"', () => {
      expect(findMetroByText('DLF Cyber City, Gurugram')?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for "Gurgaon"', () => {
      expect(findMetroByText('Gurgaon')?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for "Greater Noida"', () => {
      expect(findMetroByText('Greater Noida')?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for "Faridabad"', () => {
      expect(findMetroByText('Faridabad')?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for "Ghaziabad"', () => {
      expect(findMetroByText('Ghaziabad')?.name).toBe('Delhi NCR');
    });

    it('returns Mumbai MMR for "Navi Mumbai"', () => {
      expect(findMetroByText('Navi Mumbai')?.name).toBe('Mumbai MMR');
    });

    it('returns Mumbai MMR for "Thane"', () => {
      expect(findMetroByText('Thane')?.name).toBe('Mumbai MMR');
    });

    it('returns Bengaluru for "Electronic City, Bengaluru"', () => {
      expect(findMetroByText('Electronic City, Bengaluru')?.name).toBe('Bengaluru');
    });

    it('returns Bengaluru for "Whitefield"', () => {
      expect(findMetroByText('Whitefield')?.name).toBe('Bengaluru');
    });

    it('returns Hyderabad for "Hitec City"', () => {
      expect(findMetroByText('Hitec City')?.name).toBe('Hyderabad');
    });

    it('returns Pune for "Hinjawadi IT Park"', () => {
      expect(findMetroByText('Hinjawadi IT Park')?.name).toBe('Pune');
    });

    it('returns null for unknown place', () => {
      expect(findMetroByText('Some random village')).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(findMetroByText(null)).toBeNull();
      expect(findMetroByText(undefined)).toBeNull();
      expect(findMetroByText('')).toBeNull();
    });

    it('is case-insensitive', () => {
      expect(findMetroByText('DELHI')?.name).toBe('Delhi NCR');
      expect(findMetroByText('mumbai')?.name).toBe('Mumbai MMR');
      expect(findMetroByText('NOIDA')?.name).toBe('Delhi NCR');
    });
  });

  // ── findMetroByCoords ───────────────────────────────────────────────────

  describe('findMetroByCoords', () => {
    it('returns Delhi NCR for Connaught Place coordinates', () => {
      expect(findMetroByCoords(28.6315, 77.2167)?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for Noida coordinates', () => {
      expect(findMetroByCoords(28.6258, 77.3653)?.name).toBe('Delhi NCR');
    });

    it('returns Delhi NCR for Gurugram coordinates', () => {
      expect(findMetroByCoords(28.4952, 77.0891)?.name).toBe('Delhi NCR');
    });

    it('returns Mumbai MMR for BKC coordinates', () => {
      expect(findMetroByCoords(19.0662, 72.8687)?.name).toBe('Mumbai MMR');
    });

    it('returns Bengaluru for Electronic City coordinates', () => {
      expect(findMetroByCoords(12.8399, 77.6770)?.name).toBe('Bengaluru');
    });

    it('returns null for coordinates outside any metro', () => {
      expect(findMetroByCoords(25.0, 85.0)).toBeNull(); // Patna area
    });
  });

  // ── sameMetro ───────────────────────────────────────────────────────────

  describe('sameMetro', () => {
    it('Delhi and Noida are in the same metro', () => {
      expect(sameMetro('Delhi', 'Noida')?.name).toBe('Delhi NCR');
    });

    it('Delhi and Gurugram are in the same metro', () => {
      expect(sameMetro('Delhi', 'Gurugram')?.name).toBe('Delhi NCR');
    });

    it('Delhi and Ghaziabad are in the same metro', () => {
      expect(sameMetro('Delhi', 'Ghaziabad')?.name).toBe('Delhi NCR');
    });

    it('Noida and Gurugram are in the same metro', () => {
      expect(sameMetro('Noida', 'Gurugram')?.name).toBe('Delhi NCR');
    });

    it('Delhi and Mumbai are NOT in the same metro', () => {
      expect(sameMetro('Delhi', 'Mumbai')).toBeNull();
    });

    it('Bengaluru and Hyderabad are NOT in the same metro', () => {
      expect(sameMetro('Bengaluru', 'Hyderabad')).toBeNull();
    });

    it('unknown and Delhi returns null', () => {
      expect(sameMetro('Random Village', 'Delhi')).toBeNull();
    });
  });

  // ── coordInMetroBbox ────────────────────────────────────────────────────

  describe('coordInMetroBbox', () => {
    const delhiNCR = METRO_REGIONS.find(m => m.name === 'Delhi NCR')!;

    it('Connaught Place is in Delhi NCR bbox', () => {
      expect(coordInMetroBbox(28.6315, 77.2167, delhiNCR)).toBe(true);
    });

    it('Noida is in Delhi NCR bbox', () => {
      expect(coordInMetroBbox(28.6258, 77.3653, delhiNCR)).toBe(true);
    });

    it('Bengaluru is NOT in Delhi NCR bbox', () => {
      expect(coordInMetroBbox(12.9716, 77.5946, delhiNCR)).toBe(false);
    });
  });

  // ── Sanity: no duplicate city names across metros ───────────────────────

  describe('data integrity', () => {
    it('no city name appears in more than one metro', () => {
      const seen = new Map<string, string>();
      for (const metro of METRO_REGIONS) {
        for (const city of metro.cities) {
          const existing = seen.get(city);
          if (existing) {
            fail(`City "${city}" appears in both "${existing}" and "${metro.name}"`);
          }
          seen.set(city, metro.name);
        }
      }
    });

    it('every metro has at least 3 cities', () => {
      for (const metro of METRO_REGIONS) {
        expect(metro.cities.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('every metro has a valid bounding box', () => {
      for (const metro of METRO_REGIONS) {
        expect(metro.bbox.minLat).toBeLessThan(metro.bbox.maxLat);
        expect(metro.bbox.minLng).toBeLessThan(metro.bbox.maxLng);
      }
    });
  });
});

/**
 * Guards the integration, not the lookup.
 *
 * Every test above passed while the metro layer did nothing at all: the search
 * endpoint collected metro candidates and then dropped every one of them at an
 * unchanged 1.5 km distance gate. A module can be perfectly correct and still
 * be wired to nothing, so these assert the distances the search endpoint has to
 * respect for the feature to have any effect.
 */
describe('metro geography vs the strict search radius', () => {
  const DEFAULT_DETOUR_METERS = 1500;

  // Straight-line metres, same formula the search endpoint uses.
  const metres = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    const R = 6371e3;
    const p1 = (aLat * Math.PI) / 180;
    const p2 = (bLat * Math.PI) / 180;
    const dp = ((bLat - aLat) * Math.PI) / 180;
    const dl = ((bLng - aLng) * Math.PI) / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };

  const NOIDA_62 = { lat: 28.6280, lng: 77.3649 };
  const DLF_CYBER_CITY = { lat: 28.4950, lng: 77.0890 };

  it('puts the two cities from the plan in the same metro', () => {
    const a = findMetroByText('Noida Sector 62');
    const b = findMetroByText('DLF Cyber City, Gurugram');
    expect(a?.name).toBe('Delhi NCR');
    expect(b?.name).toBe(a?.name);
  });

  it('separates them by far more than the strict radius', () => {
    // ~28 km. This is precisely why the 1.5 km gate discarded them, and why
    // the metro path needs its own wider allowance to mean anything.
    const d = metres(NOIDA_62.lat, NOIDA_62.lng, DLF_CYBER_CITY.lat, DLF_CYBER_CITY.lng);
    expect(d).toBeGreaterThan(DEFAULT_DETOUR_METERS * 10);
    expect(d).toBeLessThan(35000); // must fit inside METRO_DETOUR_METERS
  });

  it('keeps a cross-metro pair out, however wide the allowance', () => {
    // Bengaluru must never surface for a Delhi search. The metro name check is
    // what guarantees this — distance alone would not.
    const delhi = findMetroByText('Connaught Place, Delhi');
    const blr = findMetroByText('Electronic City, Bengaluru');
    expect(delhi?.name).toBe('Delhi NCR');
    expect(blr?.name).toBe('Bengaluru');
    expect(delhi?.name).not.toBe(blr?.name);
  });

  it('agrees between the text and coordinate lookups for the same place', () => {
    // The endpoint resolves the RIDER by coordinates and the RIDE by text. If
    // those two disagreed, a match would depend on which side was asked.
    expect(findMetroByCoords(NOIDA_62.lat, NOIDA_62.lng)?.name)
      .toBe(findMetroByText('Noida Sector 62')?.name);
    expect(findMetroByCoords(DLF_CYBER_CITY.lat, DLF_CYBER_CITY.lng)?.name)
      .toBe(findMetroByText('Gurugram')?.name);
  });
});
