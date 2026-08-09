/**
 * Cross-check a photographed ID against what the user typed.
 *
 * The decision logic here is pure and unit-tested; OCR itself lives in
 * `extractText` and is the only part that touches the network.
 *
 * What this catches:
 *   - a blank/garbage/too-dark photo (no meaningful text)
 *   - a photo of a DIFFERENT document type than the one selected
 *     (uploading a PAN card while claiming Aadhaar)
 *   - a photo whose ID number does not match the number entered
 *   - an expiry printed on the card that has already passed
 *
 * What it cannot catch: a genuine document belonging to somebody else. That
 * needs a face match against the selfie, or a real KYC provider. Treat a pass
 * as "the uploaded image is the document they claim", not as proof of identity.
 */
import {
  DocumentType,
  DOCUMENT_SPECS,
  normaliseIdNumber,
  documentHasExpiry,
} from './idDocuments';

/** Below this much recognised text, treat the image as blank/unreadable. */
export const MIN_TEXT_CHARS = 25;

export interface CrossCheckInput {
  type: DocumentType;
  /** The number the user typed (already validated for format). */
  idNumber: string;
  /** Raw OCR text from the uploaded image. */
  ocrText: string;
  /** Expiry the user typed, for documents that have one. */
  expiry?: string | null;
  now?: Date;
}

export interface CrossCheckResult {
  ok: boolean;
  /** 0..1 — how confident we are this is the claimed document. */
  score: number;
  checks: {
    hasText: boolean;
    documentTypeMatches: boolean;
    idNumberMatches: boolean;
    notExpiredOnCard: boolean;
  };
  /** User-facing failure reasons, most important first. */
  reasons: string[];
}

/**
 * OCR frequently confuses these. We fold both the card text and the typed
 * number into a canonical alphabet before comparing, so a genuine document
 * isn't rejected because the scan read "O" for "0".
 */
const CONFUSIONS: Record<string, string> = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
};

function canonical(s: string): string {
  return normaliseIdNumber(s)
    .split('')
    .map((ch) => CONFUSIONS[ch] ?? ch)
    .join('');
}

/** Strip everything but alphanumerics — OCR sprinkles punctuation and spaces. */
function alnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Dates printed on Indian IDs: DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY. */
const CARD_DATE = /\b(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\b/g;

/**
 * The latest date printed on the card, which for a DL or passport is the
 * expiry. Returns null when no date is legible.
 */
export function latestPrintedDate(ocrText: string): Date | null {
  let match: RegExpExecArray | null;
  let latest: Date | null = null;
  CARD_DATE.lastIndex = 0;
  while ((match = CARD_DATE.exec(ocrText)) !== null) {
    const [, dd, mm, yyyy] = match;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (Number.isNaN(d.getTime())) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

/**
 * Decide whether an uploaded image backs up the details the user entered.
 * Pure: give it OCR text, get a verdict.
 */
export function crossCheckDocument(input: CrossCheckInput): CrossCheckResult {
  const { type, idNumber, ocrText, now = new Date() } = input;
  const spec = DOCUMENT_SPECS[type];
  const text = String(ocrText || '');
  const upper = text.toUpperCase();
  const reasons: string[] = [];

  // 1. Is there anything readable at all?
  const hasText = alnum(text).length >= MIN_TEXT_CHARS;
  if (!hasText) {
    reasons.push('We could not read any text on that image. Retake it in good light, filling the frame with the card.');
  }

  // 2. Does it look like the document type they chose?
  const documentTypeMatches = spec.keywords.some((k) => upper.includes(k.toUpperCase()));
  if (hasText && !documentTypeMatches) {
    // Name the type they actually appear to have uploaded, if we can tell.
    const looksLike = (Object.keys(DOCUMENT_SPECS) as DocumentType[])
      .filter((t) => t !== type)
      .find((t) => DOCUMENT_SPECS[t].keywords.some((k) => upper.includes(k.toUpperCase())));
    reasons.push(
      looksLike
        ? `That looks like a ${DOCUMENT_SPECS[looksLike].label}, but you selected ${spec.label}.`
        : `That image does not look like a ${spec.label}.`
    );
  }

  // 3. Does the number on the card match the number typed?
  //
  // FULL  — the whole number must appear (PAN, DL, passport, voter ID).
  // LAST4 — only the final 4 characters (Aadhaar), because the masked form
  //         prints as "XXXX XXXX 1234". Anchored to the END of an alphanumeric
  //         run on the card rather than searched loosely: a bare substring
  //         search for "1234" would happily match a PIN code, a date, or a
  //         document number that merely contains those digits.
  const typed = canonical(idNumber);
  const cardCanonical = canonical(alnum(text));
  let idNumberMatches = false;

  if (typed.length > 0) {
    if (spec.numberMatch === 'FULL') {
      idNumberMatches = cardCanonical.includes(typed);
    } else {
      const suffix = typed.slice(-4);
      // Split into runs FIRST, then canonicalise each one. Canonicalising the
      // whole text first would strip the whitespace that separates the runs,
      // collapsing the card into a single token that never ends with anything.
      const runs = (text.toUpperCase().match(/[A-Z0-9]{4,}/g) || []).map(canonical);
      idNumberMatches = runs.some((run) => run.endsWith(suffix));
    }
  }

  if (hasText && !idNumberMatches) {
    reasons.push(
      spec.numberMatch === 'LAST4'
        ? `The last 4 digits on the image don't match the ${spec.label} number you entered.`
        : `The ${spec.label} number on the image does not match the number you entered.`
    );
  }

  // 4. If the card carries an expiry, has it passed?
  let notExpiredOnCard = true;
  if (documentHasExpiry(type) && hasText) {
    const printed = latestPrintedDate(text);
    if (printed && printed.getTime() < now.getTime()) {
      notExpiredOnCard = false;
      reasons.push('The document in that image appears to have expired.');
    }
  }

  const checks = { hasText, documentTypeMatches, idNumberMatches, notExpiredOnCard };
  const weights = { hasText: 0.2, documentTypeMatches: 0.3, idNumberMatches: 0.4, notExpiredOnCard: 0.1 };
  const score = (Object.keys(weights) as (keyof typeof weights)[])
    .reduce((sum, k) => sum + (checks[k] ? weights[k] : 0), 0);

  // Every check must pass. The ID-number match is the one that actually stops
  // "type one number, photograph a different card", so nothing is optional.
  const ok = hasText && documentTypeMatches && idNumberMatches && notExpiredOnCard;
  return { ok, score: Math.round(score * 100) / 100, checks, reasons };
}

// ── OCR ────────────────────────────────────────────────────────────────────

export function isOcrConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.VISION_API_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

/**
 * Run OCR over a base64 image using Cloud Vision.
 *
 * Deliberately server-side: an on-device model would need a native module (so a
 * store build rather than an OTA) and would be far weaker on the low-light,
 * angled phone photos this will actually receive.
 */
export async function extractText(base64Image: string, accessToken: string): Promise<string> {
  const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        image: { content: base64Image },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['en', 'hi'] },
      }],
    }),
  });
  const data: any = await res.json();
  if (!res.ok) {
    throw new Error(`Vision API ${res.status}: ${data?.error?.message || 'unknown error'}`);
  }
  return data?.responses?.[0]?.fullTextAnnotation?.text || '';
}
