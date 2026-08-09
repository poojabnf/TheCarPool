// Jest is the project test runner; describe/it/expect are globals.
import {
  validateIdNumber,
  validateExpiry,
  documentHasExpiry,
  maskIdNumber,
  verhoeffValid,
  normaliseIdNumber,
} from '../idDocuments';
import { crossCheckDocument, latestPrintedDate } from '../idImageCheck';

// Verhoeff-valid 12-digit numbers (checksum computed, not real Aadhaars).
const AADHAAR_OK = '234567890124'; // check digit computed with Verhoeff

describe('verhoeffValid', () => {
  it('accepts a number with a correct check digit', () => {
    expect(verhoeffValid(AADHAAR_OK)).toBe(true);
  });

  it('rejects a single-digit typo', () => {
    expect(verhoeffValid('234567890123')).toBe(false);
  });

  it('rejects transposed digits, which is the point of Verhoeff', () => {
    // A plain mod-10 sum would not notice this swap.
    const swapped = '234567891024'; // adjacent digits swapped
    expect(verhoeffValid(swapped)).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(verhoeffValid('abcd')).toBe(false);
  });
});

describe('validateIdNumber — Aadhaar', () => {
  it('accepts a checksum-valid number, with or without spaces', () => {
    expect(validateIdNumber('AADHAAR', AADHAAR_OK).valid).toBe(true);
    expect(validateIdNumber('AADHAAR', '2345 6789 0124').valid).toBe(true);
  });

  it('rejects a made-up number that is the right length', () => {
    // This is the case that matters: 12 digits, looks fine, fails checksum.
    const r = validateIdNumber('AADHAAR', '123456789012');
    expect(r.valid).toBe(false);
  });

  it('rejects numbers starting 0 or 1, which UIDAI never issues', () => {
    expect(validateIdNumber('AADHAAR', '012345678901').code).toBe('FORMAT');
    expect(validateIdNumber('AADHAAR', '112345678901').code).toBe('FORMAT');
  });

  it('rejects the wrong length', () => {
    expect(validateIdNumber('AADHAAR', '23456789').code).toBe('FORMAT');
  });
});

describe('validateIdNumber — PAN', () => {
  it('accepts an individual PAN', () => {
    expect(validateIdNumber('PAN', 'ABCPD1234E').valid).toBe(true);
    expect(validateIdNumber('PAN', 'abcpd1234e').valid).toBe(true);
  });

  it('rejects a company PAN — a rider or driver is a person', () => {
    const r = validateIdNumber('PAN', 'ABCCD1234E'); // C = company
    expect(r.valid).toBe(false);
    expect(r.code).toBe('NOT_INDIVIDUAL');
  });

  it('rejects an invalid 4th character', () => {
    expect(validateIdNumber('PAN', 'ABCXD1234E').code).toBe('FORMAT');
  });

  it('rejects the wrong shape', () => {
    expect(validateIdNumber('PAN', 'AB1234567C').code).toBe('FORMAT');
  });
});

describe('validateIdNumber — DL, passport, voter ID', () => {
  it('accepts a well-formed licence and tolerates separators', () => {
    expect(validateIdNumber('DL', 'DL0420110149646').valid).toBe(true);
    expect(validateIdNumber('DL', 'DL-04 2011 0149646').valid).toBe(true);
  });

  it('rejects a licence with an impossible issue year', () => {
    expect(validateIdNumber('DL', 'DL0499990149646').code).toBe('FORMAT');
  });

  it('accepts a passport and a voter ID', () => {
    expect(validateIdNumber('PASSPORT', 'M1234567').valid).toBe(true);
    expect(validateIdNumber('VOTER_ID', 'ABC1234567').valid).toBe(true);
  });

  it('rejects malformed ones', () => {
    expect(validateIdNumber('PASSPORT', 'MM123456').valid).toBe(false);
    expect(validateIdNumber('VOTER_ID', 'AB12345678').valid).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(validateIdNumber('PAN', '   ').code).toBe('EMPTY');
  });
});

describe('documentHasExpiry / validateExpiry', () => {
  it('knows which documents expire', () => {
    expect(documentHasExpiry('DL')).toBe(true);
    expect(documentHasExpiry('PASSPORT')).toBe(true);
    expect(documentHasExpiry('AADHAAR')).toBe(false);
    expect(documentHasExpiry('PAN')).toBe(false);
    expect(documentHasExpiry('VOTER_ID')).toBe(false);
  });

  it('requires an expiry for documents that have one', () => {
    expect(validateExpiry('DL', null).code).toBe('MISSING');
  });

  it('rejects an expiry supplied for a document without one', () => {
    // The client disables the field; this stops a crafted request inventing one.
    expect(validateExpiry('AADHAAR', '2030-01-01').code).toBe('NOT_APPLICABLE');
  });

  it('accepts no expiry for a document without one', () => {
    expect(validateExpiry('PAN', null).valid).toBe(true);
    expect(validateExpiry('PAN', '').valid).toBe(true);
  });

  it('rejects an expired document', () => {
    expect(validateExpiry('DL', '2020-01-01', new Date('2026-08-09')).code).toBe('EXPIRED');
  });

  it('accepts a future expiry', () => {
    expect(validateExpiry('DL', '2030-01-01', new Date('2026-08-09')).valid).toBe(true);
  });

  it('rejects an unparseable date', () => {
    expect(validateExpiry('DL', 'next tuesday').code).toBe('UNPARSEABLE');
  });
});

describe('maskIdNumber', () => {
  it('keeps only the last 4 digits', () => {
    // Storing full Aadhaar numbers carries real legal exposure in India.
    expect(maskIdNumber('AADHAAR', '2345 6789 0123')).toBe('XXXXXXXX0123');
    expect(maskIdNumber('PAN', 'ABCPD1234E')).toBe('XXXXXX234E');
  });
});

describe('normaliseIdNumber', () => {
  it('strips spaces, hyphens and slashes and upper-cases', () => {
    expect(normaliseIdNumber(' dl-04/2011 0149646 ')).toBe('DL0420110149646');
  });
});

describe('crossCheckDocument', () => {
  const aadhaarText = `GOVERNMENT OF INDIA
    Ravi Kumar
    DOB: 01/01/1990
    2345 6789 0124
    UNIQUE IDENTIFICATION AUTHORITY OF INDIA`;

  it('accepts a photo matching the entered Aadhaar', () => {
    const r = crossCheckDocument({ type: 'AADHAAR', idNumber: AADHAAR_OK, ocrText: aadhaarText });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(1);
  });

  it('rejects a blank or unreadable image', () => {
    const r = crossCheckDocument({ type: 'AADHAAR', idNumber: AADHAAR_OK, ocrText: '   ' });
    expect(r.ok).toBe(false);
    expect(r.checks.hasText).toBe(false);
    expect(r.reasons[0]).toMatch(/could not read/i);
  });

  it('rejects a PAN photo when Aadhaar was selected, and says so', () => {
    const panText = `INCOME TAX DEPARTMENT
      GOVT. OF INDIA
      Permanent Account Number
      ABCPD1234E`;
    const r = crossCheckDocument({ type: 'AADHAAR', idNumber: AADHAAR_OK, ocrText: panText });
    expect(r.ok).toBe(false);
    expect(r.checks.documentTypeMatches).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/looks like a PAN card/i);
  });

  it('rejects an Aadhaar photo whose number differs from the one typed', () => {
    // The headline case: right document type, wrong card.
    const r = crossCheckDocument({ type: 'AADHAAR', idNumber: '345678901238', ocrText: aadhaarText });
    expect(r.ok).toBe(false);
    expect(r.checks.idNumberMatches).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/does not match/i);
  });

  it('tolerates OCR confusing O for 0 and I for 1', () => {
    const messy = `INCOME TAX DEPARTMENT Permanent Account Number ABCPDI234E`;
    const r = crossCheckDocument({ type: 'PAN', idNumber: 'ABCPD1234E', ocrText: messy });
    expect(r.checks.idNumberMatches).toBe(true);
  });

  it('rejects a licence whose printed expiry has passed', () => {
    const dlText = `DRIVING LICENCE TRANSPORT DEPARTMENT
      DL NO DL0420110149646
      Valid Till 01/01/2020`;
    const r = crossCheckDocument({
      type: 'DL',
      idNumber: 'DL0420110149646',
      ocrText: dlText,
      now: new Date('2026-08-09'),
    });
    expect(r.ok).toBe(false);
    expect(r.checks.notExpiredOnCard).toBe(false);
  });

  it('accepts a licence still in date', () => {
    const dlText = `DRIVING LICENCE TRANSPORT
      DL NO DL0420110149646
      Valid Till 01/01/2030`;
    const r = crossCheckDocument({
      type: 'DL',
      idNumber: 'DL0420110149646',
      ocrText: dlText,
      now: new Date('2026-08-09'),
    });
    expect(r.ok).toBe(true);
  });
});

describe('latestPrintedDate', () => {
  it('picks the latest of several printed dates', () => {
    const d = latestPrintedDate('DOB 01/01/1990 Issued 05/06/2015 Valid Till 04/06/2035');
    expect(d?.getFullYear()).toBe(2035);
  });

  it('returns null when no date is legible', () => {
    expect(latestPrintedDate('no dates here')).toBeNull();
  });
});
