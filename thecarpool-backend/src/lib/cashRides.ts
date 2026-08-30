/**
 * Pay-the-driver rides for new users.
 *
 * A first-time rider gets a small number of journeys they can book without
 * paying through the app, settling with the driver directly instead. The point
 * is trust: someone who has never used TheCarPool is being asked to hand money
 * to a stranger's platform before they have seen a single car turn up. Letting
 * the first few rides happen with cash removes that leap, and by the time the
 * allowance runs out they have watched the thing work.
 *
 * Pure — no I/O — so the rule can be tested without Firestore, and so the
 * booking endpoint and the "how many left?" endpoint cannot disagree about it.
 *
 * WHAT A CASH BOOKING IS NOT: it is not an escrowed booking with a different
 * flag. No money is held, so there is nothing to release at settlement,
 * nothing to refund on cancellation, and nothing to take a no-show penalty
 * from. Every one of those paths has to know to leave it alone; a cash booking
 * that wanders into settlement would try to pay a driver out of an escrow that
 * was never funded.
 */

/**
 * How many rides a new rider may settle directly with the driver.
 *
 * Five is enough to see the service work several times over -- a booking, a
 * driver accepting, a code at the kerb, a completed trip -- without being so
 * many that the platform carries a stranger's risk indefinitely.
 */
export const CASH_RIDE_LIMIT = 5;

/** Payment methods a booking can carry. */
export type PaymentMethod = 'RAZORPAY' | 'WALLET' | 'PAY_DRIVER';

/**
 * Booking states that do NOT consume an allowance.
 *
 * A rider whose request was declined never travelled, and a driver's refusal
 * must not cost them one of their five. Same for anything they cancelled: the
 * allowance is for rides taken, not requests made.
 */
const NON_CONSUMING_BOOKING_STATUS = new Set(['DECLINED', 'CANCELLED']);
const NON_CONSUMING_ESCROW_STATUS = new Set(['CANCELLED', 'REFUNDED']);

export interface CashBookingLike {
  payment_method?: string | null;
  booking_status?: string | null;
  escrow_status?: string | null;
}

/** Does this booking count against the rider's allowance? */
export function consumesAllowance(b: CashBookingLike): boolean {
  if (b.payment_method !== 'PAY_DRIVER') return false;
  if (b.booking_status && NON_CONSUMING_BOOKING_STATUS.has(String(b.booking_status))) return false;
  if (b.escrow_status && NON_CONSUMING_ESCROW_STATUS.has(String(b.escrow_status))) return false;
  return true;
}

export interface CashAllowance {
  limit: number;
  used: number;
  remaining: number;
  /** Whether another cash booking may be made right now. */
  eligible: boolean;
}

/**
 * Work out what a rider has left, from their bookings.
 *
 * Derived rather than counted. A stored counter drifts the first time a
 * booking is cancelled by a path that forgets to decrement it, and the failure
 * is silent and permanent -- a rider quietly loses a free ride and nobody ever
 * finds out. Recomputing from the bookings themselves cannot drift, and a
 * cancellation automatically hands the allowance back with no code to write.
 */
export function cashAllowance(bookings: CashBookingLike[]): CashAllowance {
  const used = bookings.filter(consumesAllowance).length;
  const remaining = Math.max(0, CASH_RIDE_LIMIT - used);
  return {
    limit: CASH_RIDE_LIMIT,
    used,
    remaining,
    eligible: remaining > 0,
  };
}

/**
 * Why a cash booking was refused, or null when it is allowed.
 *
 * Returns a reason rather than a boolean so the caller can say something
 * useful. "You've used all 5 of your pay-the-driver rides" is actionable;
 * a bare rejection is not.
 */
export function cashBookingRefusal(
  allowance: CashAllowance,
  seats: number
): string | null {
  if (!allowance.eligible) {
    return `You've used all ${allowance.limit} of your pay-the-driver rides. `
      + 'Pay through the app to book this one.';
  }
  // One seat per cash booking. The allowance is a trust measure for the person
  // using it, and booking four seats on it hands three strangers an unfunded
  // seat on the driver's risk.
  if (seats > 1) {
    return 'Pay-the-driver rides are limited to one seat. '
      + 'Pay through the app to book more than one.';
  }
  return null;
}

/**
 * Is this booking still live, regardless of whether money is held for it?
 *
 * The codebase used `escrow_status === 'HELD'` to mean two different things:
 * "there is money to move" and "this seat is real". Those were the same
 * question until pay-the-driver bookings existed, and are not any more -- a
 * cash booking holds nothing and is completely real, with someone standing at
 * a kerb waiting for a car.
 *
 * Use this for the second question. For the first, keep testing HELD: paying a
 * driver from an escrow that was never funded is exactly the failure this
 * separation exists to prevent.
 */
export function isBookingActive(escrowStatus: unknown): boolean {
  const status = String(escrowStatus ?? '');
  return status === 'HELD' || status === 'NONE';
}
