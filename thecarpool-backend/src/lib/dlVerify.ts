/**
 * Driving-licence verification against the Parivahan record, through a KYC
 * provider (Surepass). Dormant until SUREPASS_API_TOKEN is set: without it
 * the licence stays "declared", exactly as before.
 *
 * Only a positive answer from the provider marks a licence verified. Any
 * error, timeout or unexpected shape returns `unverified` — a failed check
 * must never turn into a badge a rider would trust.
 */
export function isDlVerificationConfigured(): boolean {
  return Boolean(process.env.SUREPASS_API_TOKEN);
}

export interface DlVerification {
  status: 'VERIFIED' | 'NOT_FOUND' | 'UNVERIFIED';
  holder_name?: string;
}

export async function verifyDrivingLicence(dlNumber: string, dobIso: string): Promise<DlVerification> {
  if (!isDlVerificationConfigured()) return { status: 'UNVERIFIED' };
  const base = process.env.SUREPASS_BASE_URL || 'https://kyc-api.surepass.io';
  try {
    const res = await fetch(`${base}/api/v1/driving-license/driving-license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUREPASS_API_TOKEN}`,
      },
      body: JSON.stringify({ id_number: dlNumber, dob: dobIso.slice(0, 10) }),
      signal: AbortSignal.timeout(15_000),
    });
    const body: any = await res.json().catch(() => null);
    if (res.ok && body?.success === true && body?.data) {
      return { status: 'VERIFIED', holder_name: body.data.name || undefined };
    }
    if (res.status === 404 || res.status === 422) return { status: 'NOT_FOUND' };
    return { status: 'UNVERIFIED' };
  } catch {
    return { status: 'UNVERIFIED' };
  }
}
