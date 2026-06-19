// KYC provider abstraction.
//
// When KYC_PROVIDER_API_URL + KYC_PROVIDER_API_KEY are configured, identity
// checks are delegated to the provider (e.g. Digio, Hyperverge, Aadhaar
// Bridge). Without keys it falls back to a format-only check that is clearly
// NOT real verification — so dev/test still flows but production must set keys.

export function isKycConfigured(): boolean {
  return Boolean(process.env.KYC_PROVIDER_API_URL && process.env.KYC_PROVIDER_API_KEY);
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.KYC_PROVIDER_API_KEY}`,
  };
}

export interface KycResult {
  verified: boolean;
  name?: string;
  simulated?: boolean;
  reason?: string;
}

export async function verifyAadhaar(aadhaar: string): Promise<KycResult> {
  if (!isKycConfigured()) {
    return { verified: /^\d{12}$/.test(aadhaar || ''), simulated: true };
  }
  try {
    const res = await fetch(`${process.env.KYC_PROVIDER_API_URL}/aadhaar/verify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ aadhaar_number: aadhaar }),
    });
    if (!res.ok) return { verified: false, reason: `provider ${res.status}` };
    const data: any = await res.json();
    return { verified: data.verified === true, name: data.name };
  } catch (err: any) {
    return { verified: false, reason: err?.message };
  }
}

export async function verifyDrivingLicence(dl: string): Promise<KycResult> {
  if (!isKycConfigured()) {
    return { verified: Boolean(dl) && dl.length > 5, simulated: true };
  }
  try {
    const res = await fetch(`${process.env.KYC_PROVIDER_API_URL}/dl/verify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ dl_number: dl }),
    });
    if (!res.ok) return { verified: false, reason: `provider ${res.status}` };
    const data: any = await res.json();
    return { verified: data.verified === true, name: data.name };
  } catch (err: any) {
    return { verified: false, reason: err?.message };
  }
}
