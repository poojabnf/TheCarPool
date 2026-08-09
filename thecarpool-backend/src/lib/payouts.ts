/**
 * Driver payout routing. Pure — no I/O — so the money-routing decision is
 * unit-testable.
 *
 * Product rule:
 *   - Driver HAS payout details  → paid straight to their account, ~2 hours
 *     after the ride completes.
 *   - Driver has NO payout details → credited to their wallet immediately on
 *     completion, with nothing held back.
 *
 * The delay is not a hold on the driver's money — it is a settlement window.
 * Bank payouts are irreversible, so a short gap leaves room for a rider dispute
 * or a mis-clicked completion to surface before the funds leave the platform.
 *
 * NOTE ON THE 24-HOUR RULE: that applies to a RIDER withdrawing a refund
 * (no-show or cancellation) to their bank. It does not apply to driver
 * earnings, which follow the 2-hour window below. Two different flows.
 */

/** How long after completion a driver's earnings are released to their bank. */
export const PAYOUT_DELAY_MS = 2 * 60 * 60 * 1000;

/**
 * Grace period before a due payout is considered late. Only used for
 * reporting — a sweep that runs every 15 minutes will comfortably beat the
 * "2-3 hours" the driver is promised.
 */
export const PAYOUT_LATE_AFTER_MS = 3 * 60 * 60 * 1000;

export type PayoutMethodType = 'VPA' | 'BANK_ACCOUNT';

export interface PayoutMethod {
  type: PayoutMethodType;
  /** UPI id, for type VPA. */
  vpa?: string | null;
  /** Bank details, for type BANK_ACCOUNT. */
  account_number?: string | null;
  ifsc?: string | null;
  name?: string | null;
}

/** Basic shape checks so we never hand Razorpay something obviously unusable. */
const VPA_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{6,18}$/;

export interface PayoutMethodValidation {
  valid: boolean;
  reason?: string;
}

export function validatePayoutMethod(m: Partial<PayoutMethod> | null | undefined): PayoutMethodValidation {
  if (!m || !m.type) return { valid: false, reason: 'Choose how you want to be paid.' };

  if (m.type === 'VPA') {
    const vpa = String(m.vpa || '').trim();
    if (!VPA_RE.test(vpa)) return { valid: false, reason: 'That UPI ID does not look right (e.g. name@bank).' };
    return { valid: true };
  }

  if (m.type === 'BANK_ACCOUNT') {
    const acc = String(m.account_number || '').replace(/\s/g, '');
    const ifsc = String(m.ifsc || '').toUpperCase().trim();
    const name = String(m.name || '').trim();
    if (!ACCOUNT_RE.test(acc)) return { valid: false, reason: 'Enter a valid account number (6-18 digits).' };
    if (!IFSC_RE.test(ifsc)) return { valid: false, reason: 'Enter a valid IFSC code (e.g. HDFC0001234).' };
    if (name.length < 2) return { valid: false, reason: "Enter the account holder's name." };
    return { valid: true };
  }

  return { valid: false, reason: 'Unsupported payout method.' };
}

/** True when the driver has usable payout details on file. */
export function hasPayoutMethod(method: Partial<PayoutMethod> | null | undefined): boolean {
  return validatePayoutMethod(method).valid;
}

export type PayoutDestination = 'BANK' | 'WALLET';

export interface PayoutPlan {
  destination: PayoutDestination;
  /** ISO timestamp the payout becomes due. Equal to completion for wallet. */
  due_at: string;
  /** Can the driver spend it right away? True for the wallet path. */
  available_immediately: boolean;
  /** Short line for the driver-facing UI. */
  message: string;
}

/**
 * Decide where a driver's earnings go and when.
 *
 * `amount` is only used to shape the message; routing does not depend on it.
 */
export function planPayout(opts: {
  method?: Partial<PayoutMethod> | null;
  completedAt?: Date;
  amount?: number;
}): PayoutPlan {
  const completedAt = opts.completedAt ?? new Date();

  if (hasPayoutMethod(opts.method)) {
    const due = new Date(completedAt.getTime() + PAYOUT_DELAY_MS);
    return {
      destination: 'BANK',
      due_at: due.toISOString(),
      available_immediately: false,
      message: 'Your earnings will reach your account within about 2 hours.',
    };
  }

  return {
    destination: 'WALLET',
    due_at: completedAt.toISOString(),
    available_immediately: true,
    message: 'Added to your wallet. Add your bank details to get paid directly next time.',
  };
}

/** Payouts that are due now, given the current time. */
export function isPayoutDue(dueAtIso: string, now = new Date()): boolean {
  const t = Date.parse(dueAtIso);
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime();
}

/** Mask a payout destination for display and logs — never echo it in full. */
export function maskPayoutMethod(m: Partial<PayoutMethod> | null | undefined): string {
  if (!m || !m.type) return 'not set';
  if (m.type === 'VPA') {
    const vpa = String(m.vpa || '');
    const [user, bank] = vpa.split('@');
    if (!bank) return 'UPI';
    const shown = user.length <= 2 ? user : `${user.slice(0, 2)}${'*'.repeat(Math.max(0, user.length - 2))}`;
    return `${shown}@${bank}`;
  }
  const acc = String(m.account_number || '').replace(/\s/g, '');
  return acc.length > 4 ? `A/C ****${acc.slice(-4)}` : 'bank account';
}
