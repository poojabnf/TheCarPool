/**
 * Phone-canonical identity.
 *
 * Firebase issues a DIFFERENT uid per sign-in provider, so the same person
 * signing in with Google on Android and phone OTP on iOS lands on two separate
 * user documents — and is asked to onboard and verify a second time. The phone
 * number is the one identifier that is genuinely the same person across all of
 * them, so it is the anchor.
 *
 * This module is pure: normalising and deciding WHAT to carry across is
 * testable without Firestore. The route does the reading and writing.
 */

/** Firestore document id for a phone number (no '+', which is legal but ugly). */
export function phoneKey(e164: string): string {
  return e164.replace(/^\+/, '');
}

/**
 * Normalise an Indian mobile number to E.164, or null if it can't be one.
 *
 * Accepts the shapes users and providers actually produce: '+91 98765 43210',
 * '09876543210', '9876543210', '919876543210'. Indian mobiles are 10 digits
 * starting 6-9, which is what makes the ambiguous cases decidable.
 */
export function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;

  // Already E.164 — which is exactly what a Firebase token carries. Trust it
  // rather than forcing it through the India-specific rules below: sign-in now
  // supports 27 countries, and a US or UK number would otherwise normalise to
  // null and silently never link across devices.
  const asString = String(raw).trim();
  if (/^\+[1-9]\d{7,14}$/.test(asString)) return asString;

  let digits = asString.replace(/\D/g, '');
  if (!digits) return null;

  // Strip an international prefix written as 00 rather than '+'.
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Country code.
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  // Domestic trunk prefix.
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** The phone number attached to an identity, from a token or a stored profile. */
export function phoneOf(source: Record<string, any> | null | undefined): string | null {
  if (!source) return null;
  return normalisePhone(
    source.phone_number ?? source.phoneNumber ?? source.phone ?? null
  );
}

/**
 * Normalise an email for use as an identity key, or null if it isn't one.
 *
 * Lower-cased and trimmed, and nothing more. Deliberately NOT applying
 * provider-specific rules (Gmail ignoring dots, +tags): those would merge
 * addresses that a user may consider separate accounts, and wrongly merging
 * two people's profiles is far worse than failing to merge one person's.
 */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  // Deliberately loose: this validates "is this shaped like an address we can
  // key on", not deliverability.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Firestore document id for an email.
 *
 * '/' is the only character Firestore forbids outright, and a lone '.' or
 * '..' is reserved — none of which a valid address produces, but the slash is
 * replaced defensively rather than trusting that.
 */
export function emailKey(email: string): string {
  return email.replace(/\//g, '_');
}

/** The email attached to an identity, from a token or a stored profile. */
export function emailOf(source: Record<string, any> | null | undefined): string | null {
  if (!source) return null;
  return normaliseEmail(source.email ?? source.corporate_email ?? null);
}

/**
 * Profile fields that follow the person, not the sign-in method.
 *
 * Deliberately excluded:
 *   - anything holding money (wallet balance, escrow, ledger pointers). Copying
 *     a balance onto a second uid would let it be spent twice.
 *   - ids and timestamps that belong to the document (uid, created_at).
 *   - push tokens, which are per-device, not per-person.
 */
export const PORTABLE_FIELDS = [
  'name', 'displayName', 'address', 'gender', 'role', 'vehicle_type',
  'corporate_email', 'photo_url', 'avatar_path', 'onboarded',
  // Where earnings go. Not money itself — an instruction, and the same one.
  'payout_method',
] as const;

/**
 * What to copy from an existing identity onto the one signing in now.
 *
 * Only fills gaps: a field already set on the target wins, because that is the
 * more recent thing the person did. Returns an empty object when there is
 * nothing to carry, so the caller can skip the write entirely.
 */
export function portableProfile(
  source: Record<string, any> | null | undefined,
  target: Record<string, any> | null | undefined = null
): Record<string, any> {
  if (!source) return {};
  const out: Record<string, any> = {};
  for (const field of PORTABLE_FIELDS) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    const existing = target?.[field];
    if (existing !== undefined && existing !== null && existing !== '' && existing !== false) continue;
    out[field] = value;
  }
  return out;
}

export interface LinkDecision {
  /** Write/refresh the phone → uid index. */
  claimIndex: boolean;
  /** Copy profile across from another uid (null when there is nothing to adopt). */
  adoptFrom: string | null;
}

/**
 * Decide what to do when `uid` signs in holding `phone`.
 *
 * - Nobody owns the number yet → this uid claims it.
 * - This uid already owns it → nothing to do.
 * - Another uid owns it → same person on a different provider: adopt their
 *   profile, and leave the index pointing at the original. The original stays
 *   canonical so a person's history has one stable home, and so repeated
 *   sign-ins can't ping-pong the index between two uids.
 */
export function decideLink(
  uid: string,
  ownerUid: string | null | undefined
): LinkDecision {
  if (!ownerUid) return { claimIndex: true, adoptFrom: null };
  if (ownerUid === uid) return { claimIndex: false, adoptFrom: null };
  return { claimIndex: false, adoptFrom: ownerUid };
}
