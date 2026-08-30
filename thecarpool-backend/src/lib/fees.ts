/**
 * Fare add-ons, cancellation and no-show economics. Pure — no I/O — so every
 * rupee-splitting rule is unit-testable.
 *
 * Platform economics (product decision, 2026-08-09):
 *  - Zero convenience fee. A completed ride pays the driver 100% of the fare;
 *    the platform earns nothing on it.
 *  - The platform's only ride revenue is its share of cancellation / no-show
 *    penalties.
 *  - The optional insurance premium is collected on top of the fare and is NOT
 *    part of the driver payout — it is held for remittance to the insurer.
 */

import { round2 } from './money';


// ── Convenience fee ────────────────────────────────────────────────────────
export const CONVENIENCE_FEE = 0;

// ── Insurance ──────────────────────────────────────────────────────────────
// ₹1 per 20 km, charged in whole blocks: every started 20 km costs a rupee, so
// a 12 km hop is ₹1 and a 25 km run is ₹2. Block pricing rather than a linear
// ₹0.05/km because it keeps the premium a round rupee figure (no ₹0.60 line
// items) and is a single sentence to explain to a rider.
//
// These constants are the whole rate card — change them here when the insurer
// deal lands and quote/booking/refund/payout-exclusion all follow.
export const INSURANCE_KM_PER_RUPEE = 20;
export const INSURANCE_MIN_PREMIUM = 1;
export const INSURANCE_MAX_PREMIUM = 50; // sanity bound at ~1000 km

/**
 * Optional per-journey insurance premium, priced on trip distance.
 * Returns 0 for a non-positive/unknown distance so a missing distance can never
 * silently charge the rider a minimum premium.
 */
export function insurancePremium(distanceKm: number): number {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  const blocks = Math.ceil(km / INSURANCE_KM_PER_RUPEE);
  return round2(Math.min(INSURANCE_MAX_PREMIUM, Math.max(INSURANCE_MIN_PREMIUM, blocks)));
}

// ── Cancellation ───────────────────────────────────────────────────────────
export type CancellationTier = 'FREE' | 'STANDARD' | 'LATE' | 'LATE_HOUR' | 'IMMINENT';

export interface CancellationOutcome {
  tier: CancellationTier;
  /** Percentage of the fare charged as a cancellation fee (0, 20, 50 or 60). */
  fee_pct: number;
  /** Fee charged, in rupees. */
  fee: number;
  /** Amount returned to the rider, in rupees. */
  refund: number;
  /** Portion of the fee paid to the driver for showing up. */
  driver_share: number;
  /** Remainder of the fee retained by the platform. */
  platform_share: number;
  /** Insurance premium is always returned in full on cancellation. */
  insurance_refund: number;
}

// The rate card. Every tier is a refund percentage, expressed here as the fee
// that produces it, because the fee is what the rest of the system splits.
//
//   4h or more before departure -> 100% back   (no fee)
//   2h to 4h                    ->  80% back   (20% fee)
//   1h to 2h                    ->  50% back   (50% fee)
//   under 1h, or never cancelled ->  40% back  (60% fee)
//
// Steeper than what this replaced (free at 2h, 10% at 1-2h, 20% under 1h)
// because the old card barely distinguished a rider who gave a day's notice
// from one who vanished at the kerb, and the driver had already turned down
// other riders for that seat.
export const FREE_CANCEL_MINUTES = 240;    // >=4h before departure -> full refund
export const STANDARD_CANCEL_MINUTES = 120; // 2-4h -> 20% fee
export const LATE_CANCEL_MINUTES = 60;      // 1-2h -> 50% fee; under 1h -> 60%
export const IMMINENT_CANCEL_MINUTES = 15;  // under 15m the driver is compensated

/**
 * What the driver keeps from a cancellation, as a % of the FARE, per tier.
 *
 * The fee exists to compensate a driver who turned other riders away for a
 * seat that is now empty, so the driver's share grows as their chance of
 * refilling it shrinks. The platform takes the remainder of the fee, which
 * also has to absorb the payment-gateway charge on the original booking --
 * that is not returned when we refund.
 *
 *   tier         fee   driver   platform
 *   FREE          0%      0%        0%
 *   STANDARD     20%     10%       10%
 *   LATE         50%     15%       35%
 *   LATE_HOUR    60%     20%       40%
 *   IMMINENT     60%     30%       30%
 *
 * This replaces a single IMMINENT_DRIVER_PCT of 5% that applied only under 15
 * minutes, which meant the very worst cancellation paid the driver least of
 * all -- nothing at 90 minutes, and 5% at 10 minutes.
 *
 * Every value here must stay at or below its tier's fee_pct, or the platform
 * share goes negative and we would be paying the driver out of the rider's
 * refund. cancellationOutcome clamps it regardless, and a test pins it.
 */
export const DRIVER_CANCEL_PCT: Record<CancellationTier, number> = {
  FREE: 0,
  STANDARD: 10,
  LATE: 15,
  LATE_HOUR: 20,
  IMMINENT: 30,
};

/**
 * Work out what a rider is charged for cancelling, given how long remains
 * before departure. Used both to *preview* the charge in the confirmation
 * dialog and to actually apply it, so the two can never disagree.
 *
 * A non-finite `minutesToDeparture` (unknown departure time) is treated as the
 * free tier — we don't penalise a rider for our own missing data.
 */
export function cancellationOutcome(
  fare: number,
  minutesToDeparture: number,
  insurance = 0
): CancellationOutcome {
  const amount = Math.max(0, Number(fare) || 0);
  const premium = round2(Math.max(0, Number(insurance) || 0));
  const mins = Number(minutesToDeparture);

  let tier: CancellationTier;
  let fee_pct: number;
  if (!Number.isFinite(mins) || mins >= FREE_CANCEL_MINUTES) {
    tier = 'FREE';
    fee_pct = 0;
  } else if (mins >= STANDARD_CANCEL_MINUTES) {
    tier = 'STANDARD';
    fee_pct = 20;
  } else if (mins >= LATE_CANCEL_MINUTES) {
    tier = 'LATE';
    fee_pct = 50;
  } else {
    // Under an hour. IMMINENT is the same 60% but additionally compensates the
    // driver, who at that point is already on their way.
    tier = mins >= IMMINENT_CANCEL_MINUTES ? 'LATE_HOUR' : 'IMMINENT';
    fee_pct = 60;
  }

  const fee = round2((amount * fee_pct) / 100);
  // Clamped to the fee: the driver's compensation comes out of what was
  // charged, never out of the rider's refund.
  const driver_share = round2(Math.min(fee, (amount * DRIVER_CANCEL_PCT[tier]) / 100));

  return {
    tier,
    fee_pct,
    fee,
    refund: round2(amount - fee),
    driver_share,
    platform_share: round2(fee - driver_share),
    insurance_refund: premium,
  };
}

// ── No-show ────────────────────────────────────────────────────────────────
// Matches the under-an-hour cancellation tier deliberately: a rider who
// simply does not turn up should not do better than one who at least told
// somebody. It was 80%, which made silence the cheaper option.
export const NO_SHOW_REFUND_PCT = 40;
// Same 30% an imminent cancellation pays. A driver who waited at the pickup,
// drove with an empty seat and was never told has lost at least as much as one
// cancelled on ten minutes before departure -- and used to receive 5%.
export const NO_SHOW_DRIVER_PCT = 30;

export interface NoShowOutcome {
  refund: number;         // back to the rider's wallet
  driver_share: number;
  platform_share: number;
  insurance_refund: number;
}

/**
 * Rider neither travelled nor cancelled: they get 80% back to their wallet, the
 * driver 5% for turning up, and the platform retains the rest.
 *
 * "Didn't travel" is determined by the boarding OTP never being verified — the
 * same signal that gates the driver's fare payout.
 */
export function noShowOutcome(fare: number, insurance = 0): NoShowOutcome {
  const amount = Math.max(0, Number(fare) || 0);
  const refund = round2((amount * NO_SHOW_REFUND_PCT) / 100);
  const driver_share = round2((amount * NO_SHOW_DRIVER_PCT) / 100);
  return {
    refund,
    driver_share,
    platform_share: round2(amount - refund - driver_share),
    insurance_refund: round2(Math.max(0, Number(insurance) || 0)),
  };
}

// ── Withdrawals ────────────────────────────────────────────────────────────
/**
 * Money earned from a ride can only be withdrawn to a bank account 24 hours
 * after that ride, leaving a window for disputes and chargebacks before funds
 * leave the platform.
 */
export const WITHDRAWAL_HOLD_MS = 24 * 60 * 60 * 1000;

/** Total a rider must pay up front for a booking. */
export function bookingTotal(fare: number, insurance = 0): number {
  const amount = Math.max(0, Number(fare) || 0);
  const premium = Math.max(0, Number(insurance) || 0);
  return round2(amount + premium + CONVENIENCE_FEE);
}
