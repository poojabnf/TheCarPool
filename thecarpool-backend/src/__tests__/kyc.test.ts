import { verifyAadhaar, verifyDrivingLicence, isKycConfigured } from '../lib/kyc';

describe('KYC provider abstraction (unconfigured/simulated mode)', () => {
  beforeEach(() => {
    delete process.env.KYC_PROVIDER_API_URL;
    delete process.env.KYC_PROVIDER_API_KEY;
  });

  test('reports unconfigured without provider env', () => {
    expect(isKycConfigured()).toBe(false);
  });

  test('simulated Aadhaar check enforces 12-digit format and flags itself', async () => {
    const ok = await verifyAadhaar('123456789012');
    expect(ok.verified).toBe(true);
    expect(ok.simulated).toBe(true); // callers must treat this as NOT real KYC

    expect((await verifyAadhaar('12345')).verified).toBe(false);
    expect((await verifyAadhaar('12345678901a')).verified).toBe(false);
    expect((await verifyAadhaar('')).verified).toBe(false);
  });

  test('simulated DL check enforces minimum length and flags itself', async () => {
    const ok = await verifyDrivingLicence('DL0420201234567');
    expect(ok.verified).toBe(true);
    expect(ok.simulated).toBe(true);

    expect((await verifyDrivingLicence('ab')).verified).toBe(false);
  });

  test('configured mode is detected from env', () => {
    process.env.KYC_PROVIDER_API_URL = 'https://api.example.com';
    process.env.KYC_PROVIDER_API_KEY = 'k';
    expect(isKycConfigured()).toBe(true);
  });
});
