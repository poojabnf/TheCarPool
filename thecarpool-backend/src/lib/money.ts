/**
 * Money.
 *
 * Rupee amounts are stored and passed around as JS numbers, which are IEEE-754
 * doubles and cannot represent most decimal fractions exactly. 0.1 + 0.2 is
 * 0.30000000000000004, and a fare assembled from a base, a per-seat split and
 * an insurance premium drifts by fractions of a paisa. Two consequences:
 *
 *   1. A total computed one way can differ from the same total computed
 *      another way, in the last bits.
 *   2. A comparison like `paid >= due` can be false when the two are the same
 *      amount of money.
 *
 * The comparison problem used to be papered over by adding a paisa of slack
 * (`if (paid + 0.01 >= due)`), which is a real hole: it accepts a payment
 * genuinely one paisa short, and it hides the drift rather than removing it.
 *
 * This module fixes the comparison properly, by converting to integer paise —
 * the smallest unit actually transactable — and comparing exactly. Razorpay
 * works in paise for the same reason.
 *
 * NOTE ON SCOPE: this does not convert the whole system to integer storage.
 * Balances remain rupee numbers in Firestore. What it does guarantee is that
 * every rounding uses one implementation, and every money comparison is exact
 * rather than approximate. Migrating storage to paise is a larger change and
 * belongs on its own.
 */

/** Paise in a rupee. */
const PAISE = 100;

/**
 * Round a rupee amount to paise.
 *
 * Was defined identically in six files (fees, pricing, rideSettlement,
 * bookings, payments, rides), which meant six chances to fix a rounding bug
 * in five places. The Number.EPSILON nudge pulls values that landed a hair
 * below a .xx5 boundary — 1.005 is stored as 1.00499999999999989 — back up so
 * they round the way a person reading the number expects.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * PAISE) / PAISE;
}

/**
 * Rupees → integer paise. The unit comparisons and provider calls happen in.
 *
 * Throws on values that cannot be money (NaN, Infinity): a silent 0 here
 * would be read as "free" and could release a seat or a payout for nothing.
 */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new Error(`Not a valid money amount: ${rupees}`);
  }
  return Math.round((rupees + Number.EPSILON) * PAISE);
}

/** Integer paise → rupees, for storage and display. */
export function fromPaise(paise: number): number {
  return Math.round(paise) / PAISE;
}

/**
 * Is `amount` at least `required`?
 *
 * Exact, in paise. Replaces `amount + 0.01 >= required`, which answered yes
 * for an amount one paisa short — the slack was there to absorb float drift
 * and could not tell drift from a genuine shortfall. Converting first removes
 * the drift, so no slack is needed and none is given.
 */
export function isAtLeast(amount: number, required: number): boolean {
  return toPaise(amount) >= toPaise(required);
}

/** Is `amount` strictly less than `required`? The negation of isAtLeast. */
export function isShortOf(amount: number, required: number): boolean {
  return !isAtLeast(amount, required);
}

/** Do two rupee amounts represent the same money? */
export function equals(a: number, b: number): boolean {
  return toPaise(a) === toPaise(b);
}

/**
 * Add rupee amounts without accumulating drift.
 *
 * Summing in paise and converting once at the end keeps a long chain of
 * additions exact, where repeated rupee addition would not.
 */
export function sum(...amounts: number[]): number {
  return fromPaise(amounts.reduce((acc, a) => acc + toPaise(a), 0));
}

/** Subtract, in paise, returning rupees. */
export function subtract(a: number, b: number): number {
  return fromPaise(toPaise(a) - toPaise(b));
}
