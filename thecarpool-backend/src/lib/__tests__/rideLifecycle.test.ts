// Jest is the project test runner; describe/it/expect are globals.
import { canTransition, isSettableStatus } from '../rideLifecycle';

describe('isSettableStatus', () => {
  it('accepts the three statuses a driver can set', () => {
    expect(isSettableStatus('STARTED')).toBe(true);
    expect(isSettableStatus('COMPLETED')).toBe(true);
    expect(isSettableStatus('CANCELLED')).toBe(true);
  });

  it('rejects SCHEDULED and unknown values', () => {
    // SCHEDULED is the creation state, not something a client sets.
    expect(isSettableStatus('SCHEDULED')).toBe(false);
    expect(isSettableStatus('')).toBe(false);
    expect(isSettableStatus('completed')).toBe(false);
    expect(isSettableStatus('DELETED')).toBe(false);
  });
});

describe('canTransition', () => {
  it('allows the happy path SCHEDULED → STARTED → COMPLETED', () => {
    expect(canTransition('SCHEDULED', 'STARTED')).toBe(true);
    expect(canTransition('STARTED', 'COMPLETED')).toBe(true);
  });

  it('refuses to complete a ride that never started', () => {
    // This is the money-critical rule: COMPLETED settles escrow and pays the
    // driver, so it must not be reachable straight from SCHEDULED.
    expect(canTransition('SCHEDULED', 'COMPLETED')).toBe(false);
  });

  it('refuses to re-complete or restart a finished ride', () => {
    expect(canTransition('COMPLETED', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'STARTED')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('refuses to restart an already-started ride', () => {
    expect(canTransition('STARTED', 'STARTED')).toBe(false);
  });

  it('allows cancelling before and during, but not after', () => {
    expect(canTransition('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(canTransition('STARTED', 'CANCELLED')).toBe(true);
    expect(canTransition('CANCELLED', 'CANCELLED')).toBe(false);
  });

  it('treats a missing status as SCHEDULED', () => {
    expect(canTransition('', 'STARTED')).toBe(true);
    expect(canTransition('', 'COMPLETED')).toBe(false);
  });
});
