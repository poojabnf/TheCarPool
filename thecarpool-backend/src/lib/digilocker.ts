/**
 * DigiLocker Aadhaar verification via Setu's Data Gateway API.
 *
 * Replaces the old "type a number, photograph the card, OCR it" flow: the
 * user consents on DigiLocker's own login page, and UIDAI-signed data comes
 * back directly — a verified name/DOB/gender and a masked Aadhaar number.
 * We never see, request, or store the full Aadhaar number or a document
 * image. See https://docs.setu.co/data/digilocker.
 *
 * Sandbox base URL is used unless SETU_DIGILOCKER_BASE_URL overrides it —
 * point that at https://dg.setu.co once Setu activates production access.
 */

const BASE_URL = process.env.SETU_DIGILOCKER_BASE_URL || 'https://dg-sandbox.setu.co';

export function isDigilockerConfigured(): boolean {
  return Boolean(
    process.env.SETU_DIGILOCKER_CLIENT_ID &&
    process.env.SETU_DIGILOCKER_CLIENT_SECRET &&
    process.env.SETU_DIGILOCKER_PRODUCT_INSTANCE_ID
  );
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-client-id': process.env.SETU_DIGILOCKER_CLIENT_ID || '',
    'x-client-secret': process.env.SETU_DIGILOCKER_CLIENT_SECRET || '',
    'x-product-instance-id': process.env.SETU_DIGILOCKER_PRODUCT_INSTANCE_ID || '',
  };
}

export interface CreateRequestResult {
  id: string;
  status: string;
  url: string;
  validUpto: string;
}

/** Start a DigiLocker consent flow. `redirectUrl` gets `success`/`id`/`scope` appended by Setu. */
export async function createDigilockerRequest(redirectUrl: string): Promise<CreateRequestResult> {
  const res = await fetch(`${BASE_URL}/api/digilocker/`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ redirectUrl }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Setu DigiLocker create request failed (${res.status}): ${data?.message || 'unknown error'}`);
  }
  return { id: data.id, status: data.status, url: data.url, validUpto: data.validUpto };
}

export interface DigilockerStatus {
  id: string;
  status: 'unauthenticated' | 'authenticated' | 'revoked' | string;
  digilockerUserDetails?: { digilockerId?: string; email?: string; phoneNumber?: string };
}

export async function getDigilockerStatus(requestId: string): Promise<DigilockerStatus> {
  const res = await fetch(`${BASE_URL}/api/digilocker/${encodeURIComponent(requestId)}/status`, {
    method: 'GET',
    headers: headers(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Setu DigiLocker status check failed (${res.status}): ${data?.message || 'unknown error'}`);
  }
  return data;
}

export interface DigilockerAadhaar {
  name: string;
  dateOfBirth: string;
  gender: string;
  /** Already masked by DigiLocker/UIDAI, e.g. "xxxx-xxxx-1234". Never the full number. */
  maskedNumber: string;
  verified: { email: boolean; phone: boolean; signature: boolean };
}

/** Fetch the verified eAadhaar data for an authenticated request. Only ever masked/summary fields. */
export async function fetchDigilockerAadhaar(requestId: string): Promise<DigilockerAadhaar> {
  const res = await fetch(`${BASE_URL}/api/digilocker/${encodeURIComponent(requestId)}/aadhaar`, {
    method: 'GET',
    headers: headers(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Setu DigiLocker Aadhaar fetch failed (${res.status}): ${data?.message || 'unknown error'}`);
  }
  const a = data.aadhaar || {};
  return {
    name: a.name || '',
    dateOfBirth: a.dateOfBirth || '',
    gender: a.gender || '',
    maskedNumber: a.maskedNumber || '',
    verified: a.verified || { email: false, phone: false, signature: false },
  };
}

export async function revokeDigilockerRequest(requestId: string): Promise<void> {
  await fetch(`${BASE_URL}/api/digilocker/${encodeURIComponent(requestId)}/revoke`, {
    method: 'GET',
    headers: headers(),
  }).catch(() => {});
}
