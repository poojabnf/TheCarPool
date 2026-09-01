// Jest is the project test runner; describe/it/expect are globals.
import {
  isAtDestination, isDisputeWindowOpen, disputeMinutesRemaining,
  isSettlementDue, settlementDueAt, canResolveDispute,
  ARRIVAL_RADIUS_METERS, DISPUTE_WINDOW_MINUTES, SETTLEMENT_HOLD_MINUTES,
} from '../settlement';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

describe('isAtDestination', () => {
  // Jhansi station, and points a known distance away.
  const dLat = 25.4484, dLng = 78.5685;

  it('is true when the rider is essentially there', () => {
    expect(isAtDestination(dLat, dLng, dLat, dLng)).toBe(true);
    // ~5 m north: within the radius.
    expect(isAtDestination(dLat + 0.000045, dLng, dLat, dLng)).toBe(true);
  });

  it('is false a short distance away', () => {
    // ~50 m north: outside a 10 m radius.
    expect(isAtDestination(dLat + 0.00045, dLng, dLat, dLng)).toBe(false);
  });

  it('rejects a missing GPS fix rather than treating 0,0 as a location', () => {
    expect(isAtDestination(0, 0, dLat, dLng)).toBe(false);
  });

  it('rejects unusable input instead of guessing', () => {
    expect(isAtDestination(null, null, dLat, dLng)).toBe(false);
    expect(isAtDestination('abc', dLng, dLat, dLng)).toBe(false);
    expect(isAtDestination(undefined, undefined, undefined, undefined)).toBe(false);
  });

  it('honours a custom radius', () => {
    expect(isAtDestination(dLat + 0.00045, dLng, dLat, dLng, 100)).toBe(true);
  });

  it('uses a tight default so it cannot fire mid-journey', () => {
    expect(ARRIVAL_RADIUS_METERS).toBe(10);
  });
});

describe('isDisputeWindowOpen', () => {
  it('is open inside the window', () => {
    expect(isDisputeWindowOpen(minutesAgo(0), NOW)).toBe(true);
    expect(isDisputeWindowOpen(minutesAgo(9), NOW)).toBe(true);
    expect(isDisputeWindowOpen(minutesAgo(DISPUTE_WINDOW_MINUTES), NOW)).toBe(true);
  });

  it('is closed once it has passed', () => {
    expect(isDisputeWindowOpen(minutesAgo(16), NOW)).toBe(false);
    expect(isDisputeWindowOpen(minutesAgo(120), NOW)).toBe(false);
  });

  it('does not close on a completion timestamped slightly in the future', () => {
    // Clock skew between a phone and the server must not rob the rider of it.
    const future = new Date(NOW.getTime() + 30000).toISOString();
    expect(isDisputeWindowOpen(future, NOW)).toBe(true);
  });

  it('is closed for an unusable timestamp', () => {
    expect(isDisputeWindowOpen(null, NOW)).toBe(false);
    expect(isDisputeWindowOpen('nope', NOW)).toBe(false);
  });
});

describe('disputeMinutesRemaining', () => {
  it('counts down and floors at zero', () => {
    expect(disputeMinutesRemaining(minutesAgo(0), NOW)).toBe(DISPUTE_WINDOW_MINUTES);
    expect(disputeMinutesRemaining(minutesAgo(7), NOW)).toBe(8);
    expect(disputeMinutesRemaining(minutesAgo(30), NOW)).toBe(0);
    expect(disputeMinutesRemaining(null, NOW)).toBe(0);
  });
});

describe('isSettlementDue', () => {
  const held = {
    escrow_status: 'HELD',
    booking_status: 'CONFIRMED',
    completed_at: minutesAgo(SETTLEMENT_HOLD_MINUTES),
  };

  it('settles once the hold has elapsed', () => {
    expect(isSettlementDue(held, NOW)).toBe(true);
    expect(isSettlementDue({ ...held, completed_at: minutesAgo(90) }, NOW)).toBe(true);
  });

  it('waits while the hold is still running', () => {
    expect(isSettlementDue({ ...held, completed_at: minutesAgo(14) }, NOW)).toBe(false);
    expect(isSettlementDue({ ...held, completed_at: minutesAgo(1) }, NOW)).toBe(false);
  });

  it('never settles a disputed ride', () => {
    expect(isSettlementDue({ ...held, disputed: true }, NOW)).toBe(false);
    // Even long after the hold.
    expect(isSettlementDue({ ...held, disputed: true, completed_at: minutesAgo(600) }, NOW)).toBe(false);
  });

  it('only settles money that is actually held', () => {
    expect(isSettlementDue({ ...held, escrow_status: 'CANCELLED' }, NOW)).toBe(false);
    expect(isSettlementDue({ ...held, escrow_status: 'SETTLED' }, NOW)).toBe(false);
    expect(isSettlementDue({ ...held, escrow_status: undefined }, NOW)).toBe(false);
  });

  it('never pays out a request the driver did not accept', () => {
    expect(isSettlementDue({ ...held, booking_status: 'REQUESTED' }, NOW)).toBe(false);
    expect(isSettlementDue({ ...held, booking_status: 'DECLINED' }, NOW)).toBe(false);
  });

  it('treats a legacy booking with no booking_status as confirmed', () => {
    const { booking_status, ...legacy } = held;
    expect(isSettlementDue(legacy, NOW)).toBe(true);
  });

  it('does not settle a ride that was never completed', () => {
    expect(isSettlementDue({ ...held, completed_at: null }, NOW)).toBe(false);
    expect(isSettlementDue({ ...held, completed_at: 'nope' }, NOW)).toBe(false);
  });
});

describe('canResolveDispute', () => {
  it('allows resolving an open dispute over money still in escrow', () => {
    expect(canResolveDispute({ disputed: true, escrow_status: 'HELD' })).toBe(true);
  });

  it('refuses when there is no dispute', () => {
    expect(canResolveDispute({ disputed: false, escrow_status: 'HELD' })).toBe(false);
    expect(canResolveDispute({ escrow_status: 'HELD' })).toBe(false);
  });

  it('refuses once the fare has left escrow — that money is already gone', () => {
    expect(canResolveDispute({ disputed: true, escrow_status: 'SETTLED' })).toBe(false);
    expect(canResolveDispute({ disputed: true, escrow_status: 'CANCELLED' })).toBe(false);
    expect(canResolveDispute({ disputed: true })).toBe(false);
  });
});

describe('settlementDueAt', () => {
  it('is fifteen minutes after completion', () => {
    expect(settlementDueAt('2026-08-28T12:00:00.000Z')).toBe('2026-08-28T12:15:00.000Z');
  });

  it('is null for an unusable time', () => {
    expect(settlementDueAt('nope')).toBeNull();
  });
});

describe('the fifteen-minute rule', () => {
  const NOW2 = new Date('2026-08-28T12:00:00.000Z');
  const ago = (m: number) => new Date(NOW2.getTime() - m * 60000).toISOString();
  const held = { escrow_status: 'HELD', booking_status: 'CONFIRMED' } as const;

  it('pays at fifteen minutes with no complaint', () => {
    expect(isSettlementDue({ ...held, completed_at: ago(15) }, NOW2)).toBe(true);
    expect(isSettlementDue({ ...held, completed_at: ago(14.9) }, NOW2)).toBe(false);
  });

  // A rider who alights at a mid-route stop has finished their trip; they
  // should not wait on a journey that continues for hours without them.
  it('runs from the rider getting out, not the end of the ride', () => {
    expect(isSettlementDue(
      { ...held, dropped_off_at: ago(20), completed_at: null }, NOW2
    )).toBe(true);
    // Drop-off wins even when the ride finished only moments ago.
    expect(isSettlementDue(
      { ...held, dropped_off_at: ago(20), completed_at: ago(1) }, NOW2
    )).toBe(true);
    // And a recent drop-off is not overridden by an older completion.
    expect(isSettlementDue(
      { ...held, dropped_off_at: ago(2), completed_at: ago(90) }, NOW2
    )).toBe(false);
  });

  it('falls back to completion when no drop-off was recorded', () => {
    expect(isSettlementDue({ ...held, completed_at: ago(30) }, NOW2)).toBe(true);
  });

  it('still refuses to pay a complained-about ride, however long it waits', () => {
    expect(isSettlementDue(
      { ...held, disputed: true, dropped_off_at: ago(600) }, NOW2
    )).toBe(false);
  });
});
