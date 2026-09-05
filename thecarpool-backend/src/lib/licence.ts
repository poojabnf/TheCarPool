/**
 * Driving licence details for a driver.
 *
 * There was no verification of any kind: dl_number appeared only in seed data,
 * and anyone with a phone could publish a ride and carry strangers. This does
 * not fix that on its own -- read the next paragraph carefully.
 *
 * WHAT THIS IS: a declared licence, checked for shape and expiry, recorded
 * against the driver. It is not proof. Nobody has confirmed the number belongs
 * to this person or that the licence exists, and the code must never imply
 * otherwise -- a badge saying "verified" on the strength of a self-typed
 * number is worse than no badge, because a rider would believe it.
 *
 * WHAT IT IS FOR: it creates the record that real verification needs to check
 * against, refuses the obviously invalid, and makes a driver state something
 * attributable before carrying passengers. Actual verification means a KYC
 * provider (Surepass, Signzy and similar expose a Parivahan-backed DL check);
 * when one is wired in, it sets `verified_at` here and nothing else changes.
 *
 * Pure -- no I/O -- so the format rules are testable directly.
 */

/**
 * Indian driving licence numbers.
 *
 * Two letters of state code, two digits of RTO, then the year and a serial.
 * Written in the wild with spaces and hyphens in every combination, so
 * punctuation is stripped before matching rather than demanded in one shape.
 * Deliberately permissive on the serial: states differ, and a real licence
 * refused by our regex is a driver we have wrongly turned away.
 */
const DL_PATTERN = /^[A-Z]{2}\d{2}\d{4}\d{7}$|^[A-Z]{2}\d{2}\d{11}$/;

export function normaliseLicence(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase().replace(/[\s\-/]/g, '');
  if (s.length < 10 || s.length > 20) return null;
  return s;
}

export interface LicenceCheck {
  ok: boolean;
  /** Why it was refused, in words a driver can act on. */
  reason?: string;
  normalised?: string;
}

export function checkLicence(
  rawNumber: unknown,
  rawExpiry: unknown,
  now: Date = new Date()
): LicenceCheck {
  const normalised = normaliseLicence(rawNumber);
  if (!normalised) {
    return { ok: false, reason: 'Enter your licence number as printed on the card.' };
  }
  if (!/^[A-Z]{2}\d{2}/.test(normalised)) {
    return {
      ok: false,
      reason: 'That does not look like an Indian licence number. It starts with your state code, e.g. DL01.',
    };
  }
  if (!DL_PATTERN.test(normalised)) {
    return { ok: false, reason: 'Check the licence number — it seems to be missing some digits.' };
  }

  const expiry = Date.parse(String(rawExpiry ?? ''));
  if (!Number.isFinite(expiry)) {
    return { ok: false, reason: 'Enter the expiry date shown on your licence.' };
  }
  // An expired licence is not a formatting problem; it means they should not
  // be driving passengers today.
  if (expiry <= now.getTime()) {
    return { ok: false, reason: 'That licence has expired. Renew it before offering rides.' };
  }

  return { ok: true, normalised };
}

/** Only ever the last four, for a screen. The rest has no business being shown. */
export function maskLicence(normalised: string | null | undefined): string | null {
  const s = String(normalised ?? '');
  if (s.length < 4) return null;
  return `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

export interface LicenceOnFile {
  dl_number?: string | null;
  dl_expiry?: string | null;
}

/** Is there a usable licence recorded, and is it still in date? */
export function hasValidLicence(d: LicenceOnFile | null | undefined, now: Date = new Date()): boolean {
  if (!d?.dl_number) return false;
  const expiry = Date.parse(String(d.dl_expiry ?? ''));
  return Number.isFinite(expiry) && expiry > now.getTime();
}
