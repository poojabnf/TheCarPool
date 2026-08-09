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

/** Rounds to paise. Money is handled in rupees as a JS number. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Convenience fee ────────────────────────────────────────────────────────
export const CONVENIENCE_FEE = 0;

// ── Insurance ──────────────────────────────────────────────────────────────
// PLACEHOLDER RATES. The insurer partnership is not signed yet; these three
// constants are the only thing that needs to change once a rate card exists.
// Everything downstream (quote, booking, payout exclusion) is already wired.
export const INSURANCE_RATE_PER_KM = 0.5;
export const INSURANCE_MIN_PREMIUM = 10;
export const INSURANCE_MAX_PREMIUM = 100;

/**
 * Optional per-journey insurance premium, priced on trip distance.
 * Returns 0 for a non-positive/unknown distance so a missing distance can never
 * silently charge the rider a minimum premium.
 */
export function insurancePremium(distanceKm: number): number {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  const raw = km * INSURANCE_RATE_PER_KM;
  return round2(Math.min(INSURANCE_MAX_PREMIUM, Math.max(INSURANCE_MIN_PREMIUM, raw)));
}

// ── Cancellation ───────────────────────────────────────────────────────────
export type CancellationTier = 'FREE' | 'STANDARD' | 'LATE' | 'IMMINENT';

export interface CancellationOutcome {
  tier: CancellationTier;
  /** Percentage of the fare charged as a cancellation fee (0, 10 or 20). */
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

export const FREE_CANCEL_MINUTES = 120;   // ≥2h before departure → full refund
export const LATE_CANCEL_MINUTES = 60;    // 1–2h → 10%; under 1h → 20%
export const IMMINENT_CANCEL_MINUTES = 15; // under 15m the driver is compensated
/** Driver's cut of an imminent cancellation, as a % of the fare. */
export const IMMINENT_DRIVER_PCT = 5;

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
  } else if (mins >= LATE_CANCEL_MINUTES) {
    tier = 'STANDARD';
    fee_pct = 10;
  } else if (mins >= IMMINENT_CANCEL_MINUTES) {
    tier = 'LATE';
    fee_pct = 20;
  } else {
    tier = 'IMMINENT';
    fee_pct = 20;
  }

  const fee = round2((amount * fee_pct) / 100);
  const driver_share = tier === 'IMMINENT'
    ? round2(Math.min(fee, (amount * IMMINENT_DRIVER_PCT) / 100))
    : 0;

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
export const NO_SHOW_REFUND_PCT = 80;
export const NO_SHOW_DRIVER_PCT = 5;

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
