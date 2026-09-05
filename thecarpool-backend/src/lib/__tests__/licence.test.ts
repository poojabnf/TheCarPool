import { checkLicence, normaliseLicence, maskLicence, hasValidLicence } from '../licence';

const FUTURE = '2030-01-01';
const NOW = new Date('2026-09-04T00:00:00.000Z');

describe('normaliseLicence', () => {
  it('accepts the punctuation people actually type', () => {
    expect(normaliseLicence('DL-14 2023 0004242')).toBe('DL1420230004242');
    expect(normaliseLicence('dl1420230004242')).toBe('DL1420230004242');
    expect(normaliseLicence('UP/16/2024/0009999')).toBe('UP1620240009999');
  });

  it('rejects what is not a string or is the wrong length', () => {
    expect(normaliseLicence(null)).toBeNull();
    expect(normaliseLicence(12345)).toBeNull();
    expect(normaliseLicence('DL01')).toBeNull();
  });
});

describe('checkLicence', () => {
  it('accepts a well-formed licence in date', () => {
    const r = checkLicence('DL-14 2023 0004242', FUTURE, NOW);
    expect(r.ok).toBe(true);
    expect(r.normalised).toBe('DL1420230004242');
  });

  it('explains what is wrong rather than just refusing', () => {
    expect(checkLicence('', FUTURE, NOW).reason).toMatch(/licence number/i);
    expect(checkLicence('1234567890123', FUTURE, NOW).reason).toMatch(/state code/i);
    expect(checkLicence('DL142023000', FUTURE, NOW).reason).toMatch(/digits/i);
  });

  // Not a formatting problem: it means they should not be driving today.
  it('refuses an expired licence', () => {
    const r = checkLicence('DL1420230004242', '2024-01-01', NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expired/i);
  });

  it('requires an expiry date at all', () => {
    expect(checkLicence('DL1420230004242', undefined, NOW).reason).toMatch(/expiry/i);
    expect(checkLicence('DL1420230004242', 'sometime', NOW).reason).toMatch(/expiry/i);
  });
});

describe('maskLicence', () => {
  it('shows only the last four', () => {
    expect(maskLicence('DL1420230004242')).toBe('•••••••••••4242');
  });

  it('returns null rather than leaking a short value whole', () => {
    expect(maskLicence('DL1')).toBeNull();
    expect(maskLicence(null)).toBeNull();
  });
});

describe('hasValidLicence', () => {
  it('needs both a number and an unexpired date', () => {
    expect(hasValidLicence({ dl_number: 'DL1420230004242', dl_expiry: FUTURE }, NOW)).toBe(true);
    expect(hasValidLicence({ dl_number: 'DL1420230004242', dl_expiry: '2024-01-01' }, NOW)).toBe(false);
    expect(hasValidLicence({ dl_number: 'DL1420230004242' }, NOW)).toBe(false);
    expect(hasValidLicence({ dl_expiry: FUTURE }, NOW)).toBe(false);
    expect(hasValidLicence(null, NOW)).toBe(false);
  });
});
