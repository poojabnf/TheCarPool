/**
 * Ride lifecycle rules. Pure — no I/O — so the transition table can be
 * unit-tested directly.
 *
 * SCHEDULED → STARTED → COMPLETED
 * SCHEDULED | STARTED → CANCELLED
 *
 * COMPLETED is what settles escrow and pays the driver, so it must only ever be
 * reachable from STARTED: allowing SCHEDULED → COMPLETED would let a driver
 * collect fares for a trip that never picked anyone up.
 */
export const RIDE_STATUSES = ['SCHEDULED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** Statuses a client is allowed to move a ride *to*. */
export const SETTABLE_STATUSES = ['STARTED', 'COMPLETED', 'CANCELLED'] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

const ALLOWED_FROM: Record<SettableStatus, readonly RideStatus[]> = {
  STARTED: ['SCHEDULED'],
  COMPLETED: ['STARTED'],
  CANCELLED: ['SCHEDULED', 'STARTED'],
};

export function isSettableStatus(status: string): status is SettableStatus {
  return (SETTABLE_STATUSES as readonly string[]).includes(status);
}

/** Whether a ride currently in `current` may move to `next`. */
export function canTransition(current: string, next: SettableStatus): boolean {
  const from = (current || 'SCHEDULED') as RideStatus;
  return ALLOWED_FROM[next].includes(from);
}
