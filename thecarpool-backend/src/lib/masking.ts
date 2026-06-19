// Proxy-number masking abstraction (Twilio Proxy).
//
// Configured via TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PROXY_SERVICE_SID.
// Creates a Twilio Proxy session between two real phone numbers and returns the
// masked proxy number each party sees. Without keys it returns
// { configured: false } so the caller can respond honestly (no fake number).

export function isMaskingConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PROXY_SERVICE_SID
  );
}

export interface MaskedCallResult {
  configured: boolean;
  proxy_number?: string;
  session_sid?: string;
  expiry_mins?: number;
  reason?: string;
}

async function twilioForm(path: string, body: Record<string, string>): Promise<any> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`https://proxy.twilio.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}`);
  return res.json();
}

/**
 * Create a masked session between rider and driver phone numbers.
 * Returns the proxy number the rider should dial.
 */
export async function createMaskedCall(riderPhone: string, driverPhone: string): Promise<MaskedCallResult> {
  if (!isMaskingConfigured()) {
    return { configured: false, reason: 'Masking provider not configured.' };
  }
  try {
    const service = process.env.TWILIO_PROXY_SERVICE_SID as string;
    const session = await twilioForm(`/Services/${service}/Sessions`, { Mode: 'voice', Ttl: '7200' });
    // Add both participants; Twilio assigns each a proxy identifier.
    await twilioForm(`/Services/${service}/Sessions/${session.sid}/Participants`, { Identifier: riderPhone });
    const driverParticipant = await twilioForm(
      `/Services/${service}/Sessions/${session.sid}/Participants`,
      { Identifier: driverPhone }
    );
    return {
      configured: true,
      session_sid: session.sid,
      proxy_number: driverParticipant.proxy_identifier,
      expiry_mins: 120,
    };
  } catch (err: any) {
    return { configured: true, reason: err?.message };
  }
}
