/**
 * When a completed ride's fare actually reaches the driver.
 *
 * Completion no longer pays out instantly. A ride can be marked complete by
 * the rider, or automatically when they arrive at the destination, and either
 * way the rider gets a short window to say "no, that didn't happen" before the
 * money moves. Once the hold expires with no dispute, the fare settles.
 *
 * The two windows are deliberately different lengths:
 *   - DISPUTE_WINDOW (10 min) is how long the rider has to raise a problem.
 *     Short, because it is meant to be used while they are still standing
 *     there, not a day later.
 *   - SETTLEMENT_HOLD (1 hour) is how long the money waits. Longer than the
 *     dispute window on purpose, so a dispute raised at minute 9 still lands
 *     well before any payout, even if a sweep runs late.
 *
 * Pure — no I/O — so every rule here is unit-testable.
 */

/** How long the rider has to dispute a completion. */
export const DISPUTE_WINDOW_MINUTES = 10;

/** How long the fare is held after completion before it can settle. */
export const SETTLEMENT_HOLD_MINUTES = 60;

/**
 * How close the rider must be to the destination for the app to call the ride
 * complete on its own.
 *
 * 10 m is tight — roughly GPS's own margin on a good fix. That is deliberate:
 * a false auto-completion starts a payout clock for a ride that may still be
 * moving, so it should fire only when there is genuinely no doubt. A rider who
 * is close but not within the radius can always complete the ride by hand.
 */
export const ARRIVAL_RADIUS_METERS = 10;

function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Is the rider standing at the destination? */
export function isAtDestination(
  riderLat: unknown,
  riderLng: unknown,
  destLat: unknown,
  destLng: unknown,
  radiusMeters: number = ARRIVAL_RADIUS_METERS
): boolean {
  const a = [riderLat, riderLng, destLat, destLng].map(Number);
  if (a.some((n) => !Number.isFinite(n))) return false;
  const [rLat, rLng, dLat, dLng] = a;
  // 0,0 is the null-island signature of a missing fix, not a real location.
  if (rLat === 0 && rLng === 0) return false;
  return metresBetween(rLat, rLng, dLat, dLng) <= radiusMeters;
}

/** Can the rider still dispute this completion? */
export function isDisputeWindowOpen(
  completedAtIso: string | null | undefined,
  now: Date = new Date()
): boolean {
  const t = Date.parse(String(completedAtIso ?? ''));
  if (!Number.isFinite(t)) return false;
  const elapsedMinutes = (now.getTime() - t) / 60000;
  // A clock skew that puts completion slightly in the future must not close
  // the window; only elapsed time past the limit does.
  return elapsedMinutes <= DISPUTE_WINDOW_MINUTES;
}

/** Minutes left to dispute, floored at 0. */
export function disputeMinutesRemaining(
  completedAtIso: string | null | undefined,
  now: Date = new Date()
): number {
  const t = Date.parse(String(completedAtIso ?? ''));
  if (!Number.isFinite(t)) return 0;
  const remaining = DISPUTE_WINDOW_MINUTES - (now.getTime() - t) / 60000;
  return Math.max(0, Math.ceil(remaining));
}

export interface SettlementCandidate {
  /** When the ride was marked complete. */
  completed_at?: string | null;
  /** Set when the rider raised a problem. Blocks settlement outright. */
  disputed?: boolean;
  /** Money state; only a held fare can settle. */
  escrow_status?: string | null;
  /** Requests never accepted must not pay out. */
  booking_status?: string | null;
}

/**
 * Should this booking's fare go to the driver now?
 *
 * Every condition is a hard no on its own — this decides whether real money
 * moves, so it fails closed on anything ambiguous.
 */
export function isSettlementDue(
  booking: SettlementCandidate,
  now: Date = new Date()
): boolean {
  if (booking?.disputed === true) return false;
  if (String(booking?.escrow_status ?? '') !== 'HELD') return false;
  // Missing booking_status means it predates approvals, when every booking was
  // confirmed by definition.
  if (String(booking?.booking_status ?? 'CONFIRMED') !== 'CONFIRMED') return false;

  const t = Date.parse(String(booking?.completed_at ?? ''));
  if (!Number.isFinite(t)) return false;
  return (now.getTime() - t) / 60000 >= SETTLEMENT_HOLD_MINUTES;
}

/**
 * How a human resolves a disputed fare.
 *
 * A dispute deliberately parks the money rather than deciding for itself, so
 * these are the only two ways it can end. Both are final: the fare leaves
 * escrow either way, and the booking can never be settled twice.
 */
export type DisputeResolution = 'PAY_DRIVER' | 'REFUND_RIDER';

export interface DisputeResolvable {
  disputed?: boolean;
  escrow_status?: string | null;
}

/**
 * Can this dispute still be resolved?
 *
 * Only an open dispute over money still in escrow. Once the fare has settled
 * or been refunded there is nothing left to decide, and pretending otherwise
 * would let an admin move money that is already gone.
 */
export function canResolveDispute(booking: DisputeResolvable): boolean {
  if (booking?.disputed !== true) return false;
  return String(booking?.escrow_status ?? '') === 'HELD';
}

/** ISO time this booking becomes settleable, for storing on the doc. */
export function settlementDueAt(completedAtIso: string): string | null {
  const t = Date.parse(String(completedAtIso));
  if (!Number.isFinite(t)) return null;
  return new Date(t + SETTLEMENT_HOLD_MINUTES * 60000).toISOString();
}
