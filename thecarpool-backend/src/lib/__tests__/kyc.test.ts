import { validatePan, normalisePan, maskPan, panStatus, panSurnameInitial, nameMatchesPan } from '../kyc';

describe('normalisePan', () => {
  it('uppercases and strips the separators people type', () => {
    expect(normalisePan('abcde1234f')).toBe('ABCDE1234F');
    expect(normalisePan('ABCDE 1234 F')).toBe('ABCDE1234F');
    expect(normalisePan('ABCDE-1234-F')).toBe('ABCDE1234F');
  });

  it('returns an empty string for non-strings rather than throwing', () => {
    expect(normalisePan(null)).toBe('');
    expect(normalisePan(undefined)).toBe('');
    expect(normalisePan(12345)).toBe('');
  });
});

describe('validatePan', () => {
  it('accepts a well-formed individual PAN', () => {
    expect(validatePan('ABCPE1234F').valid).toBe(true);
  });

  it('accepts one typed in lower case with spaces', () => {
    expect(validatePan('abcpe 1234 f').valid).toBe(true);
  });

  it('rejects an empty value with an actionable message', () => {
    const r = validatePan('');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Enter your PAN/i);
  });

  it('rejects the wrong length', () => {
    expect(validatePan('ABCPE1234').valid).toBe(false);
    expect(validatePan('ABCPE1234FG').valid).toBe(false);
  });

  it('rejects a transposed PAN that has digits and letters swapped', () => {
    // Right length, wrong shape — the sort of typo that would otherwise only
    // surface at payout time, after the rider has been charged.
    expect(validatePan('ABC1E2345F').valid).toBe(false);
  });

  it('rejects a company PAN, since driver earnings are personal income', () => {
    const r = validatePan('ABCCE1234F'); // 4th char 'C' = company
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/personal PAN/i);
  });

  it('allows a HUF PAN alongside an individual one', () => {
    expect(validatePan('ABCHE1234F').valid).toBe(true);
  });
});

describe('maskPan', () => {
  it('shows only enough for the owner to recognise their own', () => {
    expect(maskPan('ABCPE1234F')).toBe('ABxxxxxx4F');
  });

  it('never leaks the middle, which is the identifying part', () => {
    expect(maskPan('ABCPE1234F')).not.toContain('CPE123');
  });

  it('returns null rather than a half-mask for junk', () => {
    expect(maskPan('nope')).toBeNull();
    expect(maskPan(null)).toBeNull();
  });
});

describe('panStatus', () => {
  it('is MISSING with no user at all', () => {
    expect(panStatus(null)).toBe('MISSING');
    expect(panStatus(undefined)).toBe('MISSING');
  });

  it('is MISSING when no PAN has been given', () => {
    expect(panStatus({})).toBe('MISSING');
  });

  it('is MISSING when the stored PAN is malformed', () => {
    // A junk value must not read as progress — it would show the driver a
    // "verified" state while their money still had nowhere to go.
    expect(panStatus({ pan_number: 'garbage' })).toBe('MISSING');
  });

  it('is COLLECTED once a valid PAN is held but no account exists', () => {
    expect(panStatus({ pan_number: 'ABCPE1234F' })).toBe('COLLECTED');
  });

  it('is LINKED once Razorpay has accepted a linked account', () => {
    expect(panStatus({ pan_number: 'ABCPE1234F', razorpay_account_id: 'acc_123' })).toBe('LINKED');
  });

  it('reports LINKED from the account alone, since that is what moves money', () => {
    expect(panStatus({ razorpay_account_id: 'acc_123' })).toBe('LINKED');
  });
});

describe('panSurnameInitial', () => {
  it('reads the 5th character, which encodes the surname initial', () => {
    expect(panSurnameInitial('ABCPS1234F')).toBe('S');
    expect(panSurnameInitial('abcpy1234f')).toBe('Y');
  });

  it('returns null for anything that is not a usable PAN', () => {
    expect(panSurnameInitial('nonsense')).toBeNull();
    expect(panSurnameInitial('ABCCS1234F')).toBeNull(); // company PAN
    expect(panSurnameInitial(null)).toBeNull();
  });
});

describe('nameMatchesPan', () => {
  const PAN = 'ABCPY1234F'; // surname initial: Y

  it('accepts a matching surname', () => {
    expect(nameMatchesPan(PAN, 'Sanjay Yadav').match).toBe(true);
  });

  it('accepts the surname written first, as much of India does', () => {
    // Surname-first is normal in Maharashtra and much of the south. Requiring
    // the LAST word to match would reject a great many real people.
    expect(nameMatchesPan(PAN, 'Yadav Sanjay').match).toBe(true);
  });

  it('accepts a name written with initials', () => {
    expect(nameMatchesPan(PAN, 'S. K. Yadav').match).toBe(true);
    expect(nameMatchesPan('ABCPR1234F', 'R. Kumar').match).toBe(true);
  });

  it('ignores case and extra whitespace', () => {
    expect(nameMatchesPan(PAN, '  sanjay   YADAV  ').match).toBe(true);
  });

  it('rejects a name whose surname cannot belong to this PAN', () => {
    // The case that matters: someone entering a relative's or stranger's PAN.
    const r = nameMatchesPan(PAN, 'Sanjay Sharma');
    expect(r.match).toBe(false);
    expect(r.reason).toContain('Y');
  });

  it('rejects an empty or one-character name', () => {
    expect(nameMatchesPan(PAN, '').match).toBe(false);
    expect(nameMatchesPan(PAN, 'Y').match).toBe(false);
    expect(nameMatchesPan(PAN, null).match).toBe(false);
  });

  it('rejects when the PAN itself is unusable, rather than passing blindly', () => {
    const r = nameMatchesPan('garbage', 'Sanjay Yadav');
    expect(r.match).toBe(false);
    expect(r.reason).toMatch(/valid PAN/i);
  });

  it('accepts a single-word name that matches', () => {
    // Mononyms exist and are valid on a PAN card.
    expect(nameMatchesPan(PAN, 'Yadav').match).toBe(true);
  });

  it('is not defeated by punctuation between name parts', () => {
    expect(nameMatchesPan(PAN, 'Sanjay-Kumar Yadav').match).toBe(true);
  });
});
