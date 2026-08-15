// Jest is the project test runner; describe/it/expect are globals.
import {
  normalisePhone, phoneKey, phoneOf, portableProfile, decideLink, PORTABLE_FIELDS,
} from '../identity';

describe('normalisePhone', () => {
  it('accepts the shapes people and providers actually send', () => {
    for (const raw of [
      '9876543210', '+919876543210', '+91 98765 43210', '09876543210',
      '919876543210', '0091-98765-43210', '+91-9876543210',
    ]) {
      expect(normalisePhone(raw)).toBe('+919876543210');
    }
  });

  it('rejects anything that is not an Indian mobile', () => {
    // Landlines and 1-5 leading digits are not mobiles; short/long is not a number.
    expect(normalisePhone('1234567890')).toBeNull();
    expect(normalisePhone('5876543210')).toBeNull();
    expect(normalisePhone('98765')).toBeNull();
    expect(normalisePhone('+14155552671')).toBeNull();
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
