// Jest is the project test runner; describe/it/expect are globals.
import {
  normalisePhone, phoneKey, phoneOf, portableProfile, decideLink, PORTABLE_FIELDS,
  normaliseEmail, emailKey, emailOf,
} from '../identity';

describe('normalisePhone — international', () => {
  it('accepts an E.164 number from any country, as a Firebase token supplies', () => {
    expect(normalisePhone('+14155551234')).toBe('+14155551234');   // US
    expect(normalisePhone('+447700900123')).toBe('+447700900123'); // UK
    expect(normalisePhone('+971501234567')).toBe('+971501234567'); // UAE
    expect(normalisePhone(' +6598765432 ')).toBe('+6598765432');   // SG, padded
  });

  it('still normalises bare Indian numbers', () => {
    expect(normalisePhone('9876543210')).toBe('+919876543210');
  });

  it('rejects malformed E.164', () => {
    expect(normalisePhone('+0123456789')).toBeNull(); // country code can't start 0
    expect(normalisePhone('+123')).toBeNull();        // too short
  });
});

describe('normaliseEmail', () => {
  it('lower-cases and trims', () => {
    expect(normaliseEmail('  Pooja.BNF@Gmail.COM ')).toBe('pooja.bnf@gmail.com');
  });

  it('rejects anything not shaped like an address', () => {
    expect(normaliseEmail('not-an-email')).toBeNull();
    expect(normaliseEmail('missing@domain')).toBeNull();
    expect(normaliseEmail('two words@x.com')).toBeNull();
    expect(normaliseEmail('')).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
    expect(normaliseEmail(42)).toBeNull();
  });

  it('does NOT fold Gmail dots or +tags', () => {
    // Merging these would fuse accounts a user may consider separate, and a
    // wrong merge is far worse than a missed one.
    expect(normaliseEmail('a.b@gmail.com')).toBe('a.b@gmail.com');
    expect(normaliseEmail('ab+tag@gmail.com')).toBe('ab+tag@gmail.com');
  });
});

describe('emailKey', () => {
  it('keeps a normal address intact', () => {
    expect(emailKey('pooja@example.com')).toBe('pooja@example.com');
  });

  it('replaces the one character Firestore forbids in a doc id', () => {
    expect(emailKey('we/ird@example.com')).toBe('we_ird@example.com');
  });
});

describe('emailOf', () => {
  it('reads email, then corporate_email', () => {
    expect(emailOf({ email: 'A@B.com' })).toBe('a@b.com');
    expect(emailOf({ corporate_email: 'work@corp.io' })).toBe('work@corp.io');
  });

  it('returns null when there is nothing usable', () => {
    expect(emailOf(null)).toBeNull();
    expect(emailOf({})).toBeNull();
    expect(emailOf({ email: 'nope' })).toBeNull();
  });
});

describe('normalisePhone', () => {
  it('accepts the shapes people and providers actually send', () => {
    for (const raw of [
      '9876543210', '+919876543210', '+91 98765 43210', '09876543210',
      '919876543210', '0091-98765-43210', '+91-9876543210',
    ]) {
      expect(normalisePhone(raw)).toBe('+919876543210');
    }
  });

  it('rejects a bare number that is not an Indian mobile', () => {
    // Landlines and 1-5 leading digits are not mobiles; short/long is not a number.
    // NOTE: this is about numbers with NO country code, where India is the only
    // safe assumption. A properly formed E.164 number from any country is
    // accepted — see the 'international' block below. '+14155552671' used to be
    // asserted null here, back when sign-in was India-only.
    expect(normalisePhone('1234567890')).toBeNull();
    expect(normalisePhone('5876543210')).toBeNull();
    expect(normalisePhone('98765')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
    expect(normalisePhone({} as any)).toBeNull();
  });

  it('does not mistake a 10-digit number starting 91 for a country code', () => {
    // 9198765432 is a valid mobile in its own right, not '+91 98765432'.
    expect(normalisePhone('9198765432')).toBe('+919198765432');
  });
});

describe('phoneKey', () => {
  it('drops the plus so it is a clean document id', () => {
    expect(phoneKey('+919876543210')).toBe('919876543210');
    expect(phoneKey('919876543210')).toBe('919876543210');
  });
});

describe('phoneOf', () => {
  it('reads whichever field the source happens to use', () => {
    expect(phoneOf({ phone_number: '+919876543210' })).toBe('+919876543210');
    expect(phoneOf({ phoneNumber: '9876543210' })).toBe('+919876543210');
    expect(phoneOf({ phone: '09876543210' })).toBe('+919876543210');
    expect(phoneOf(null)).toBeNull();
    expect(phoneOf({})).toBeNull();
  });
});

describe('portableProfile', () => {
  const source = {
    name: 'Asha',
    address: '12 MG Road',
    onboarded: true,
    payout_method: { type: 'VPA', vpa: 'asha@okaxis' },
  };

  it('carries the profile across', () => {
    const out = portableProfile(source);
    expect(out.name).toBe('Asha');
    expect(out.address).toBe('12 MG Road');
    expect(out.onboarded).toBe(true);
    expect(out.payout_method).toEqual({ type: 'VPA', vpa: 'asha@okaxis' });
  });

  it('never carries money', () => {
    // Copying a balance onto a second uid would let the same rupee be spent twice.
    const out = portableProfile({ ...source, wallet_balance: 500, escrow_balance: 100 });
    expect(out).not.toHaveProperty('wallet_balance');
    expect(out).not.toHaveProperty('escrow_balance');
    for (const field of ['wallet_balance', 'balance', 'escrow_balance', 'push_token']) {
      expect(PORTABLE_FIELDS as readonly string[]).not.toContain(field);
    }
  });

  it('does not overwrite what the person has already set on this account', () => {
    const out = portableProfile(source, { name: 'Asha K', address: '' });
    expect(out).not.toHaveProperty('name');
    expect(out.address).toBe('12 MG Road'); // blank counts as unset
  });

  it('skips absent values rather than writing nulls', () => {
    const out = portableProfile({ name: 'Asha', address: null, gender: undefined });
    expect(out).toEqual({ name: 'Asha' });
  });

  it('is empty when there is nothing to adopt', () => {
    expect(portableProfile(null)).toEqual({});
    expect(portableProfile({}, {})).toEqual({});
  });
});

describe('decideLink', () => {
  it('claims an unowned number', () => {
    expect(decideLink('uid-a', null)).toEqual({ claimIndex: true, adoptFrom: null });
    expect(decideLink('uid-a', undefined)).toEqual({ claimIndex: true, adoptFrom: null });
  });

  it('does nothing when this uid already owns it', () => {
    expect(decideLink('uid-a', 'uid-a')).toEqual({ claimIndex: false, adoptFrom: null });
  });

  it('adopts from the original owner and leaves the index alone', () => {
    // Repeated sign-ins from two providers must not ping-pong the index.
    expect(decideLink('uid-b', 'uid-a')).toEqual({ claimIndex: false, adoptFrom: 'uid-a' });
    expect(decideLink('uid-a', 'uid-a')).toEqual({ claimIndex: false, adoptFrom: null });
  });
});
