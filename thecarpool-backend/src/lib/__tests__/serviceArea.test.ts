import { serviceArea, isInServiceArea, isInServiceBounds, outOfAreaMessage } from '../serviceArea';

describe('serviceArea', () => {
  const original = process.env.SERVICE_COUNTRY;
  afterEach(() => {
    if (original === undefined) delete process.env.SERVICE_COUNTRY;
    else process.env.SERVICE_COUNTRY = original;
  });

  it('defaults to India', () => {
    delete process.env.SERVICE_COUNTRY;
    expect(serviceArea().iso).toBe('IN');
  });

  it('falls back to India for a country we do not have bounds for', () => {
    // Better to keep serving the launch market than to boot with an area
    // whose bounding box is undefined and reject every search.
    process.env.SERVICE_COUNTRY = 'ZZ';
    expect(serviceArea().iso).toBe('IN');
  });
});

describe('isInServiceArea', () => {
  it('accepts an Indian address', () => {
    expect(isInServiceArea('Connaught Place, New Delhi, Delhi 110001, India')).toBe(true);
  });

  it('rejects a US address — the case that started this', () => {
    expect(isInServiceArea('New York, NY, USA')).toBe(false);
    expect(isInServiceArea('1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA')).toBe(false);
  });

  it('rejects a neighbouring country inside the bounding box', () => {
    // The box has to be generous to cover India, so these fall inside it.
    // This check is the reason that is safe.
    expect(isInServiceArea('Kathmandu, Nepal')).toBe(false);
    expect(isInServiceArea('Lahore, Pakistan')).toBe(false);
    expect(isInServiceArea('Colombo, Sri Lanka')).toBe(false);
  });

  it('rejects an empty or missing address rather than assuming', () => {
    // Unknown must not mean allowed — the bounding box already lets unknowns
    // through, and this layer exists to catch what it misses.
    expect(isInServiceArea('')).toBe(false);
    expect(isInServiceArea(null)).toBe(false);
    expect(isInServiceArea(undefined)).toBe(false);
  });

  it('is not fooled by "India" appearing mid-address', () => {
    // A road named after the country is not the country.
    expect(isInServiceArea('India Street, London, UK')).toBe(false);
  });

  it('ignores case and trailing whitespace', () => {
    expect(isInServiceArea('Jhansi, Uttar Pradesh, india  ')).toBe(true);
  });
});

describe('isInServiceBounds', () => {
  it('accepts Indian coordinates', () => {
    expect(isInServiceBounds(28.6139, 77.209)).toBe(true);   // Delhi
    expect(isInServiceBounds(25.4484, 78.5685)).toBe(true);  // Jhansi
    expect(isInServiceBounds(8.0883, 77.5385)).toBe(true);   // Kanyakumari
  });

  it('rejects coordinates well outside', () => {
    expect(isInServiceBounds(40.7128, -74.006)).toBe(false); // New York
    expect(isInServiceBounds(51.5072, -0.1276)).toBe(false); // London
    expect(isInServiceBounds(-33.8688, 151.2093)).toBe(false); // Sydney
  });

  it('rejects junk instead of treating it as the origin', () => {
    expect(isInServiceBounds(NaN, 77)).toBe(false);
    expect(isInServiceBounds(Infinity, Infinity)).toBe(false);
  });

  it('rejects (0,0), which is where a dropped coordinate lands', () => {
    expect(isInServiceBounds(0, 0)).toBe(false);
  });
});

describe('outOfAreaMessage', () => {
  it('names the country, so the message is actionable', () => {
    expect(outOfAreaMessage()).toContain('India');
  });
});
