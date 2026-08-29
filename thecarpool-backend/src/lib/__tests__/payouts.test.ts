// Jest is the project test runner; describe/it/expect are globals.
import {
  planPayout,
  hasPayoutMethod,
  validatePayoutMethod,
  isPayoutDue,
  maskPayoutMethod,
  PAYOUT_DELAY_MS,
  buildPayoutStages,
} from '../payouts';

const VPA = { type: 'VPA' as const, vpa: 'ravi.kumar@okhdfcbank' };
const BANK = { type: 'BANK_ACCOUNT' as const, account_number: '123456789012', ifsc: 'HDFC0001234', name: 'Ravi Kumar' };

describe('validatePayoutMethod', () => {
  it('accepts a well-formed UPI id', () => {
    expect(validatePayoutMethod(VPA).valid).toBe(true);
  });

  it('rejects a malformed UPI id', () => {
    expect(validatePayoutMethod({ type: 'VPA', vpa: 'not-a-vpa' }).valid).toBe(false);
    expect(validatePayoutMethod({ type: 'VPA', vpa: '@bank' }).valid).toBe(false);
  });

  it('accepts a complete bank account', () => {
    expect(validatePayoutMethod(BANK).valid).toBe(true);
  });

  it('rejects a bad IFSC', () => {
    // IFSC is 4 letters, a 0, then 6 alphanumerics.
    const r = validatePayoutMethod({ ...BANK, ifsc: 'HDFC1001234' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/IFSC/i);
  });

  it('rejects a bad account number', () => {
    expect(validatePayoutMethod({ ...BANK, account_number: '123' }).valid).toBe(false);
    expect(validatePayoutMethod({ ...BANK, account_number: 'abcdefghij' }).valid).toBe(false);
  });

  it('rejects a missing account holder name', () => {
    expect(validatePayoutMethod({ ...BANK, name: '' }).valid).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(validatePayoutMethod(null).valid).toBe(false);
    expect(validatePayoutMethod({}).valid).toBe(false);
  });
});

describe('hasPayoutMethod', () => {
  it('is true only for a usable method', () => {
    expect(hasPayoutMethod(VPA)).toBe(true);
    expect(hasPayoutMethod(BANK)).toBe(true);
    expect(hasPayoutMethod(null)).toBe(false);
    expect(hasPayoutMethod({ type: 'VPA', vpa: 'broken' })).toBe(false);
  });
});

describe('planPayout', () => {
  const completedAt = new Date('2026-08-09T10:00:00Z');

  it('sends a driver with bank details to their account a day later', () => {
    const p = planPayout({ method: BANK, completedAt });
    expect(p.destination).toBe('BANK');
    expect(p.available_immediately).toBe(false);
    expect(Date.parse(p.due_at) - completedAt.getTime()).toBe(PAYOUT_DELAY_MS);
  });

  it('treats a UPI id the same as a bank account', () => {
    expect(planPayout({ method: VPA, completedAt }).destination).toBe('BANK');
  });

  it('keeps earnings in the wallet when no rail can send them', () => {
    // Details on file, but nothing able to push money out. Promising a bank
    // transfer here queues one that the processor refuses forever.
    const p = planPayout({ method: BANK, completedAt, railAvailable: false });
    expect(p.destination).toBe('WALLET');
    expect(p.available_immediately).toBe(true);
    expect(p.due_at).toBe(completedAt.toISOString());
  });

  it('says why, rather than telling a driver to add details they already gave', () => {
    const p = planPayout({ method: VPA, completedAt, railAvailable: false });
    expect(p.message).toMatch(/not switched on/i);
    expect(p.message).not.toMatch(/add your bank details/i);
  });

  it('still asks an unconfigured driver for details when no rail exists', () => {
    const p = planPayout({ method: null, completedAt, railAvailable: false });
    expect(p.message).toMatch(/add your bank details/i);
  });

  it('defaults to assuming a rail, so existing callers are unchanged', () => {
    expect(planPayout({ method: BANK, completedAt }).destination).toBe('BANK');
  });

  it('credits the wallet immediately when no method is set', () => {
    const p = planPayout({ method: null, completedAt });
    expect(p.destination).toBe('WALLET');
    expect(p.available_immediately).toBe(true);
    // Immediately means immediately — no hold, due at completion.
    expect(p.due_at).toBe(completedAt.toISOString());
  });

  it('falls back to the wallet when the stored method is unusable', () => {
    // A half-saved or corrupted method must not strand the driver's earnings.
    const p = planPayout({ method: { type: 'BANK_ACCOUNT', account_number: '123' }, completedAt });
    expect(p.destination).toBe('WALLET');
    expect(p.available_immediately).toBe(true);
  });

  it('nudges the driver to add details when paying to wallet', () => {
    expect(planPayout({ method: null, completedAt }).message).toMatch(/bank details/i);
  });
});

describe('isPayoutDue', () => {
  const now = new Date('2026-08-09T12:00:00Z');

  it('is due once the timestamp has passed', () => {
    expect(isPayoutDue('2026-08-09T11:59:00Z', now)).toBe(true);
    expect(isPayoutDue('2026-08-09T12:00:00Z', now)).toBe(true);
  });

  it('is not due before then', () => {
    expect(isPayoutDue('2026-08-09T12:01:00Z', now)).toBe(false);
  });

  it('is not due on an unparseable timestamp rather than firing early', () => {
    expect(isPayoutDue('whenever', now)).toBe(false);
  });
});

describe('maskPayoutMethod', () => {
  it('never echoes a full account number', () => {
    const masked = maskPayoutMethod(BANK);
    expect(masked).toBe('A/C ****9012');
    expect(masked).not.toContain('123456789012');
  });

  it('partially masks a UPI id but keeps the bank recognisable', () => {
    expect(maskPayoutMethod(VPA)).toBe('ra********@okhdfcbank');
  });

  it('says so when nothing is set', () => {
    expect(maskPayoutMethod(null)).toBe('not set');
  });
});

describe('buildPayoutStages', () => {
  it('generates 3 stages for INITIATED status', () => {
    const stages = buildPayoutStages('INITIATED');
    expect(stages).toHaveLength(3);
    expect(stages[0].status).toBe('COMPLETED');
    expect(stages[1].status).toBe('PENDING');
    expect(stages[2].status).toBe('PENDING');
  });

  it('marks intermediate stage as CURRENT during PROCESSING', () => {
    const stages = buildPayoutStages('PROCESSING');
    expect(stages[0].status).toBe('COMPLETED');
    expect(stages[1].status).toBe('CURRENT');
    expect(stages[2].status).toBe('PENDING');
  });

  it('marks all stages as COMPLETED on success', () => {
    const stages = buildPayoutStages('COMPLETED');
    expect(stages.every((s) => s.status === 'COMPLETED')).toBe(true);
  });

  it('marks failed status appropriately', () => {
    const stages = buildPayoutStages('FAILED');
    expect(stages[0].status).toBe('COMPLETED');
    expect(stages[1].status).toBe('FAILED');
    expect(stages[2].status).toBe('FAILED');
  });
});
