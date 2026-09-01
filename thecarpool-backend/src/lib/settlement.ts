/**
 * When a completed ride's fare actually reaches the driver.
 *
 * Completion no longer pays out instantly. A ride can be marked complete by
 * the rider, or automatically when they arrive at the destination, and either
 * way the rider gets a short window to say "no, that didn't happen" before the
 * money moves. Once the hold expires with no dispute, the fare settles.
 *
 * Both windows are fifteen minutes, and the same fifteen minutes: if the
 * person who booked has not complained a quarter of an hour after getting out
 * of the car, the driver is paid without further review. Making the hold
 * longer than the complaint window would be a second, silent review that
 * nobody asked for.
 *
 * The boundary is safe because settlement re-reads the dispute flag inside its
 * transaction, so a complaint filed in the final seconds still stops a payout
 * the sweep has already selected.
 *
 * Pure — no I/O — so every rule here is unit-testable.
 */

/**
 * How long the rider has to complain before the fare is treated as accepted.
 *
 * The operator's rule, and it is deliberately a simple one: if the person who
 * booked has not complained within a quarter of an hour of getting out of the
 * car, the driver is paid, no questions asked. Short because it is meant to be
 * used while they are still standing on the pavement -- if the trip went
 * wrong, they know immediately.
 */
export const DISPUTE_WINDOW_MINUTES = 15;

/**
 * How long the fare waits before it can settle.
 *
 * Equal to the dispute window rather than longer than it, which is the whole
 * point of the rule: no silent extra hold, no second review, paid at fifteen
 * minutes. A complaint filed in the last seconds still wins, because
 * settlement re-reads the dispute flag inside its transaction rather than
 * trusting the query that selected the booking.
 */
export const SETTLEMENT_HOLD_MINUTES = 15;

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
  /**
   * When this rider got out.
   *
   * Preferred over completed_at, because the clock the operator described runs
   * from the passenger's own drop-off, not the driver's last stop. On a
   * Jhansi to Delhi run someone alighting at Agra has finished their trip
   * hours before the ride ends, and should not wait on a journey they are no
   * longer part of. Falls back to completed_at where it was never recorded.
   */
  dropped_off_at?: string | null;
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
 * The instant this booking's fifteen minutes start running.
 *
 * One definition, used by both the due check and the stored due-at, so the
 * sweep and the timestamp on the document can never disagree about when a
 * fare becomes payable.
 */
export function settlementClockFrom(
  booking: Pick<SettlementCandidate, 'dropped_off_at' | 'completed_at'>
): number | null {
  for (const raw of [booking?.dropped_off_at, booking?.completed_at]) {
    const t = Date.parse(String(raw ?? ''));
    if (Number.isFinite(t)) return t;
  }
  return null;
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

  const t = settlementClockFrom(booking);
  if (t === null) return false;
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
