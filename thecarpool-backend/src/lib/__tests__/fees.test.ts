// Jest is the project test runner; describe/it/expect are globals.
import {
  CONVENIENCE_FEE,
  bookingTotal,
  insurancePremium,
  cancellationOutcome,
  noShowOutcome,
} from '../fees';

describe('convenience fee', () => {
  it('is zero', () => {
    expect(CONVENIENCE_FEE).toBe(0);
    expect(bookingTotal(250)).toBe(250);
  });
});

describe('insurancePremium', () => {
  it('charges 1 rupee per 20km block', () => {
    expect(insurancePremium(20)).toBe(1);
    expect(insurancePremium(40)).toBe(2);
    expect(insurancePremium(100)).toBe(5);
  });

  it('rounds a part-used block up to the next rupee', () => {
    expect(insurancePremium(21)).toBe(2);
    expect(insurancePremium(39)).toBe(2);
  });

  it('never charges below the 1 rupee minimum on a short trip', () => {
    expect(insurancePremium(2)).toBe(1);
    expect(insurancePremium(0.5)).toBe(1);
  });

  it('caps the premium on a very long trip', () => {
    expect(insurancePremium(5000)).toBe(50);
  });

  it('always returns whole rupees', () => {
    for (const km of [1, 7, 12, 33, 87, 260]) {
      expect(Number.isInteger(insurancePremium(km))).toBe(true);
    }
  });

  it('returns 0 for unknown or non-positive distance rather than the floor', () => {
    // A missing distance must not silently bill the rider a minimum premium.
    expect(insurancePremium(0)).toBe(0);
    expect(insurancePremium(-5)).toBe(0);
    expect(insurancePremium(NaN)).toBe(0);
    expect(insurancePremium(undefined as any)).toBe(0);
  });
});

describe('bookingTotal', () => {
  it('adds an opted-in premium to the fare', () => {
    expect(bookingTotal(200, 15)).toBe(215);
  });

  it('is just the fare when insurance is declined', () => {
    expect(bookingTotal(200, 0)).toBe(200);
  });
});

describe('cancellationOutcome', () => {
  it('refunds in full more than 2 hours out', () => {
    const r = cancellationOutcome(500, 180);
    expect(r.tier).toBe('FREE');
    expect(r.fee).toBe(0);
    expect(r.refund).toBe(500);
    expect(r.driver_share).toBe(0);
  });

  it('treats exactly 2 hours as still free', () => {
    expect(cancellationOutcome(500, 120).tier).toBe('FREE');
  });

  it('charges 10% between 1 and 2 hours', () => {
    const r = cancellationOutcome(500, 90);
    expect(r.tier).toBe('STANDARD');
    expect(r.fee).toBe(50);
    expect(r.refund).toBe(450);
    // Driver is only compensated on an imminent cancel.
    expect(r.driver_share).toBe(0);
    expect(r.platform_share).toBe(50);
  });

  it('charges 20% under an hour', () => {
    const r = cancellationOutcome(500, 30);
    expect(r.tier).toBe('LATE');
    expect(r.fee).toBe(100);
    expect(r.refund).toBe(400);
    expect(r.driver_share).toBe(0);
  });

  it('pays the driver 5% of the fare when cancelled under 15 minutes out', () => {
    const r = cancellationOutcome(500, 10);
    expect(r.tier).toBe('IMMINENT');
    expect(r.fee).toBe(100);          // still 20%
    expect(r.refund).toBe(400);
    expect(r.driver_share).toBe(25);  // 5% of 500
    expect(r.platform_share).toBe(75);
  });

  it('keeps fee = driver + platform share at every tier', () => {
    for (const mins of [500, 130, 119, 61, 59, 16, 14, 0]) {
      const r = cancellationOutcome(377, mins);
      expect(r.driver_share + r.platform_share).toBeCloseTo(r.fee, 2);
      expect(r.refund + r.fee).toBeCloseTo(377, 2);
    }
  });

  it('refunds the insurance premium in full regardless of tier', () => {
    expect(cancellationOutcome(500, 5, 25).insurance_refund).toBe(25);
    expect(cancellationOutcome(500, 999, 25).insurance_refund).toBe(25);
  });

  it('does not penalise the rider when the departure time is unknown', () => {
    expect(cancellationOutcome(500, NaN).tier).toBe('FREE');
  });

  it('handles a departure already in the past as imminent', () => {
    expect(cancellationOutcome(500, -30).tier).toBe('IMMINENT');
  });
});

describe('noShowOutcome', () => {
  it('splits 80 / 5 / 15 between rider, driver and platform', () => {
    const r = noShowOutcome(500);
    expect(r.refund).toBe(400);
    expect(r.driver_share).toBe(25);
    expect(r.platform_share).toBe(75);
  });

  it('never creates or destroys money', () => {
    for (const fare of [1, 99.99, 377, 1234.56]) {
      const r = noShowOutcome(fare);
      expect(r.refund + r.driver_share + r.platform_share).toBeCloseTo(fare, 2);
    }
  });

  it('returns the insurance premium on top of the 80%', () => {
    expect(noShowOutcome(500, 30).insurance_refund).toBe(30);
  });
});
