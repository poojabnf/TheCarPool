/**
 * Indian government ID document rules. Pure — no I/O — so every format rule is
 * unit-testable.
 *
 * We do not authenticate IDs against any government API or OTP, so this is the
 * only line of defence against a made-up number. Two things make it more than a
 * regex:
 *
 *  - Aadhaar carries a real **Verhoeff checksum**. A randomly typed 12-digit
 *    number fails it ~90% of the time, so this catches both typos and invention.
 *  - PAN's 4th character encodes holder type, so "AAAAA1111A" style filler is
 *    rejected rather than accepted as well-formed.
 *
 * It cannot tell you the number belongs to the person holding it. That needs a
 * KYC provider (see lib/kyc.ts) or an Aadhaar OTP flow. Treat a pass here as
 * "plausibly a real document number", never as "identity verified".
 */

export type DocumentType = 'AADHAAR' | 'PAN' | 'DL' | 'PASSPORT' | 'VOTER_ID';

export const DOCUMENT_TYPES: DocumentType[] = ['AADHAAR', 'PAN', 'DL', 'PASSPORT', 'VOTER_ID'];

export interface DocumentSpec {
  type: DocumentType;
  label: string;
  /** Does this document carry an expiry date? Drives the expiry field in the UI. */
  hasExpiry: boolean;
  /** Human-readable format hint shown under the input. */
  hint: string;
  /** Words that should appear on a photo of this document (upper-cased OCR text). */
  keywords: string[];
}

export const DOCUMENT_SPECS: Record<DocumentType, DocumentSpec> = {
  AADHAAR: {
    type: 'AADHAAR',
    label: 'Aadhaar',
    hasExpiry: false,
    hint: '12 digits, e.g. 2345 6789 0123',
    keywords: ['AADHAAR', 'AADHAR', 'UIDAI', 'UNIQUE IDENTIFICATION', 'GOVERNMENT OF INDIA'],
  },
  PAN: {
    type: 'PAN',
    label: 'PAN card',
    hasExpiry: false,
    hint: '10 characters, e.g. ABCPD1234E',
    keywords: ['INCOME TAX', 'PERMANENT ACCOUNT', 'PAN', 'GOVT. OF INDIA', 'GOVT OF INDIA'],
  },
  DL: {
    type: 'DL',
    label: 'Driving licence',
    hasExpiry: true,
    hint: 'State code + 13 digits, e.g. DL0420110149646',
    keywords: ['DRIVING LICENCE', 'DRIVING LICENSE', 'TRANSPORT', 'DL NO', 'LICENCE'],
  },
  PASSPORT: {
    type: 'PASSPORT',
    label: 'Passport',
    hasExpiry: true,
    hint: '1 letter + 7 digits, e.g. M1234567',
    keywords: ['PASSPORT', 'REPUBLIC OF INDIA', 'भारत गणराज्य'],
  },
  VOTER_ID: {
    type: 'VOTER_ID',
    label: 'Voter ID (EPIC)',
    hasExpiry: false,
    hint: '3 letters + 7 digits, e.g. ABC1234567',
    keywords: ['ELECTION COMMISSION', 'ELECTORS PHOTO', 'EPIC', 'IDENTITY CARD'],
  },
};

/** True when the document type carries an expiry date at all. */
export function documentHasExpiry(type: DocumentType): boolean {
  return DOCUMENT_SPECS[type]?.hasExpiry === true;
}

/** Strip spaces, hyphens and slashes; upper-case. */
export function normaliseIdNumber(raw: string): string {
  return String(raw || '').toUpperCase().replace(/[\s\-\/]/g, '');
}

// ── Aadhaar Verhoeff checksum ──────────────────────────────────────────────
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Verhoeff check as mandated by UIDAI for Aadhaar numbers. */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

// PAN 4th character = holder type. 'P' is an individual; the rest are
// companies, trusts, HUFs and so on, which cannot be a rider or driver.
const PAN_HOLDER_TYPES = 'ABCFGHJLPT';

export interface IdValidation {
  valid: boolean;
  normalised: string;
  /** Machine-readable failure code, absent when valid. */
  code?: 'EMPTY' | 'FORMAT' | 'CHECKSUM' | 'NOT_INDIVIDUAL' | 'UNKNOWN_TYPE';
  /** Message safe to show the user. */
  reason?: string;
}

/**
 * Validate an ID number's shape (and checksum, where the document has one).
 *
 * A pass means the number is structurally plausible — NOT that it exists or
 * belongs to this person.
 */
export function validateIdNumber(type: DocumentType, raw: string): IdValidation {
  const normalised = normaliseIdNumber(raw);
  const spec = DOCUMENT_SPECS[type];
  if (!spec) return { valid: false, normalised, code: 'UNKNOWN_TYPE', reason: 'Unsupported document type.' };
  if (!normalised) return { valid: false, normalised, code: 'EMPTY', reason: 'Enter your ID number.' };

  switch (type) {
    case 'AADHAAR': {
      if (!/^\d{12}$/.test(normalised)) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'Aadhaar must be exactly 12 digits.' };
      }
      // UIDAI never issues numbers beginning 0 or 1.
      if (/^[01]/.test(normalised)) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'Aadhaar numbers do not start with 0 or 1.' };
      }
      if (!verhoeffValid(normalised)) {
        return { valid: false, normalised, code: 'CHECKSUM', reason: "That Aadhaar number's checksum is invalid — please re-check it." };
      }
      return { valid: true, normalised };
    }
    case 'PAN': {
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalised)) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'PAN must be 5 letters, 4 digits, then a letter.' };
      }
      const holder = normalised[3];
      if (!PAN_HOLDER_TYPES.includes(holder)) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'That is not a valid PAN — the 4th character is invalid.' };
      }
      if (holder !== 'P') {
        return { valid: false, normalised, code: 'NOT_INDIVIDUAL', reason: 'Use an individual PAN (4th character P), not a company or trust PAN.' };
      }
      return { valid: true, normalised };
    }
    case 'DL': {
      // Two-letter state code, then 13 digits (RTO + 4-digit year + serial).
      if (!/^[A-Z]{2}\d{13}$/.test(normalised)) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'Licence must be a 2-letter state code followed by 13 digits.' };
      }
      const year = Number(normalised.slice(4, 8));
      const thisYear = new Date().getFullYear();
      if (year < 1950 || year > thisYear) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'The issue year in that licence number looks wrong.' };
      }
      return { valid: true, normalised };
    }
    case 'PASSPORT': {
      if (!/^[A-Z]\d{7}$/.test(normalised)) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'Passport must be 1 letter followed by 7 digits.' };
      }
      return { valid: true, normalised };
    }
    case 'VOTER_ID': {
      if (!/^[A-Z]{3}\d{7}$/.test(normalised)) {
        return { valid: false, normalised, code: 'FORMAT', reason: 'Voter ID must be 3 letters followed by 7 digits.' };
      }
      return { valid: true, normalised };
    }
    default:
      return { valid: false, normalised, code: 'UNKNOWN_TYPE', reason: 'Unsupported document type.' };
  }
}

/**
 * Mask an ID for storage and display.
 *
 * Storing full Aadhaar numbers carries real legal exposure in India, so nothing
 * downstream should ever persist the raw value — keep the last 4 only.
 */
export function maskIdNumber(type: DocumentType, raw: string): string {
  const n = normaliseIdNumber(raw);
  if (n.length <= 4) return n;
  return `${'X'.repeat(n.length - 4)}${n.slice(-4)}`;
}

export interface ExpiryValidation {
  valid: boolean;
  code?: 'NOT_APPLICABLE' | 'MISSING' | 'UNPARSEABLE' | 'EXPIRED';
  reason?: string;
}

/**
 * Validate the expiry date for document types that have one.
 *
 * Types without an expiry (Aadhaar, PAN, Voter ID) must not be given a date —
 * the client disables the field, and this rejects it server-side too so a
 * crafted request can't invent one.
 */
export function validateExpiry(type: DocumentType, expiry?: string | null, now = new Date()): ExpiryValidation {
  const applicable = documentHasExpiry(type);
  const provided = typeof expiry === 'string' && expiry.trim().length > 0;

  if (!applicable) {
    if (provided) {
      return { valid: false, code: 'NOT_APPLICABLE', reason: `${DOCUMENT_SPECS[type].label} does not have an expiry date.` };
    }
    return { valid: true };
  }
  if (!provided) {
    return { valid: false, code: 'MISSING', reason: `Enter the expiry date on your ${DOCUMENT_SPECS[type].label.toLowerCase()}.` };
  }

  const ts = Date.parse(expiry!.trim());
  if (!Number.isFinite(ts)) {
    return { valid: false, code: 'UNPARSEABLE', reason: 'Could not read that expiry date. Use YYYY-MM-DD.' };
  }
  if (ts < now.getTime()) {
    return { valid: false, code: 'EXPIRED', reason: 'That document has expired. Please use a valid one.' };
  }
  return { valid: true };
}
