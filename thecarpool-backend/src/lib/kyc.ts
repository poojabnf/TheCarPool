/**
 * Driver KYC — PAN only.
 *
 * Deliberately the smallest thing that can work. The app collects a PAN number
 * and nothing else: no uploads, no selfies, no document review queue. That is
 * what a driver has to type before their earnings can be routed to their bank.
 *
 * WHY A PAN AT ALL: Razorpay Route pays a driver by splitting the rider's
 * payment to a *linked account*, and a linked account cannot be created — let
 * alone settled to — without identifying the person receiving the money.
 * Income paid to a driver is also reportable, and a PAN is what makes that
 * possible. It is the one field that unlocks the payout path.
 *
 * WHAT THIS DOES NOT DO: validating the format here proves the string is
 * shaped like a PAN, not that it exists or belongs to this person. Razorpay
 * performs the actual verification when the linked account is created, and may
 * still ask for more before enabling settlements. Treat a stored PAN as
 * "collected", never as "verified" — see panStatus().
 */

/**
 * Permanent Account Number: five letters, four digits, one letter.
 *
 * The fourth character encodes holder type ('P' individual, 'C' company, 'H'
 * HUF, 'F' firm…) and the fifth is the first letter of the surname. Both are
 * checked below, because a transposed PAN that still matches the coarse shape
 * fails much later — at payout time, after the rider has already been charged.
 */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Holder types that can hold a personal bank account we can pay a driver at. */
const INDIVIDUAL_HOLDER_TYPES = new Set(['P', 'H']);

export interface PanValidation {
  valid: boolean;
  /** Rider-facing reason, safe to display verbatim. */
  reason?: string;
}

/** Uppercase and strip the spaces people type between the blocks. */
export function normalisePan(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s|-/g, '').toUpperCase();
}

export function validatePan(raw: unknown): PanValidation {
  const pan = normalisePan(raw);

  if (!pan) return { valid: false, reason: 'Enter your PAN number.' };
  if (pan.length !== 10) {
    return { valid: false, reason: 'A PAN is 10 characters, like ABCDE1234F.' };
  }
  if (!PAN_RE.test(pan)) {
    return { valid: false, reason: 'That PAN does not look right. The format is ABCDE1234F.' };
  }

  // A company PAN cannot be the destination for an individual driver's
  // earnings, and accepting one here produces a linked account Razorpay will
  // reject days later.
  const holderType = pan[3];
  if (!INDIVIDUAL_HOLDER_TYPES.has(holderType)) {
    return {
      valid: false,
      reason: 'Enter your personal PAN — the fourth character should be P.',
    };
  }

  return { valid: true };
}

/**
 * Mask for display and logs: ABCDE1234F → ABxxxxxx4F.
 *
 * A PAN is a national identifier. It is never echoed in full, not even back to
 * the person who typed it — it would end up in screenshots and support
 * tickets. Enough characters remain for someone to recognise their own.
 */
export function maskPan(raw: unknown): string | null {
  const pan = normalisePan(raw);
  if (pan.length !== 10) return null;
  return `${pan.slice(0, 2)}${'x'.repeat(6)}${pan.slice(-2)}`;
}

export type PanState = 'MISSING' | 'COLLECTED' | 'LINKED';

/**
 * How far along a driver is, from our side only.
 *
 * LINKED means Razorpay accepted a linked account for them and fares can be
 * split to it. COLLECTED means we hold a PAN but Razorpay has not (yet)
 * accepted one — their earnings keep accruing in the wallet. The distinction
 * matters because only LINKED actually results in money reaching a bank.
 */
export function panStatus(user: {
  pan_number?: string | null;
  razorpay_account_id?: string | null;
} | null | undefined): PanState {
  if (!user) return 'MISSING';
  if (user.razorpay_account_id) return 'LINKED';
  return validatePan(user.pan_number).valid ? 'COLLECTED' : 'MISSING';
}

/**
 * The surname initial encoded in a PAN.
 *
 * The 5th character of a PAN is the first letter of the holder's surname (for
 * an individual). It is the ONLY thing about the holder's identity that can be
 * derived from the number itself, offline, with no API call.
 */
export function panSurnameInitial(raw: unknown): string | null {
  const pan = normalisePan(raw);
  if (!validatePan(pan).valid) return null;
  return pan[4];
}

export interface NameMatch {
  match: boolean;
  /** Rider-facing explanation, safe to display. */
  reason?: string;
}

/**
 * Does this name plausibly belong to this PAN?
 *
 * WHAT THIS IS: a structural consistency check. The PAN's 5th character must
 * be the first letter of the holder's surname, so we check it against the
 * initials of the words in the name given. It catches the case that matters
 * in practice — someone entering a family member's or a stranger's PAN.
 *
 * WHAT THIS IS NOT: verification. Nothing offline can confirm a PAN exists or
 * that this person holds it; that needs a PAN verification API and a contract
 * with a provider. Razorpay performs its own KYC when the linked account is
 * created, and that remains the real check. Do not describe this to a user as
 * "PAN verified".
 *
 * Deliberately forgiving about WHICH word is the surname. Indian names order
 * differently across regions — surname first in Maharashtra and much of the
 * south, last in the north, and many people write initials expanded or not —
 * so any word matching is accepted. Requiring the LAST word to match would
 * reject large numbers of legitimate users, and a check that fires on honest
 * people gets switched off.
 */
export function nameMatchesPan(rawPan: unknown, rawName: unknown): NameMatch {
  const initial = panSurnameInitial(rawPan);
  if (!initial) return { match: false, reason: 'Enter a valid PAN first.' };

  const name = String(rawName ?? '').trim();
  if (name.length < 2) {
    return { match: false, reason: 'Enter your name exactly as printed on your PAN card.' };
  }

  // Words only; strip initials-with-dots and punctuation so "R. K. Sharma"
  // yields R, K, SHARMA.
  const words = name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return { match: false, reason: 'Enter your name exactly as printed on your PAN card.' };
  }

  if (words.some((w) => w[0] === initial)) return { match: true };

  return {
    match: false,
    reason: `That name doesn't match this PAN. The 5th character of your PAN is "${initial}", so your surname should begin with "${initial}". Enter your name exactly as printed on the card.`,
  };
}
