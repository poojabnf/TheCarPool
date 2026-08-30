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
  // The published rate card: 4h+ 100%, 2-4h 80%, 1-2h 50%, under 1h 40%.
  it('refunds in full 4 hours or more out', () => {
    const r = cancellationOutcome(500, 300);
    expect(r.tier).toBe('FREE');
    expect(r.fee).toBe(0);
    expect(r.refund).toBe(500);
    expect(r.driver_share).toBe(0);
  });

  it('treats exactly 4 hours as still free', () => {
    expect(cancellationOutcome(500, 240).tier).toBe('FREE');
  });

  it('refunds 80% between 2 and 4 hours', () => {
    const r = cancellationOutcome(500, 180);
    expect(r.tier).toBe('STANDARD');
    expect(r.fee).toBe(100);
    expect(r.refund).toBe(400);
    expect(r.driver_share).toBe(50);    // 10% of 500
    expect(r.platform_share).toBe(50);
  });

  it('refunds 50% between 1 and 2 hours', () => {
    const r = cancellationOutcome(500, 90);
    expect(r.tier).toBe('LATE');
    expect(r.fee).toBe(250);
    expect(r.refund).toBe(250);
    expect(r.driver_share).toBe(75);    // 15% of 500
    expect(r.platform_share).toBe(175);
  });

  it('refunds 40% under an hour', () => {
    const r = cancellationOutcome(500, 30);
    expect(r.tier).toBe('LATE_HOUR');
    expect(r.fee).toBe(300);
    expect(r.refund).toBe(200);
    expect(r.driver_share).toBe(100);   // 20% of 500
    expect(r.platform_share).toBe(200);
  });

  it('pays the driver 5% of the fare when cancelled under 15 minutes out', () => {
    const r = cancellationOutcome(500, 10);
    expect(r.tier).toBe('IMMINENT');
    expect(r.fee).toBe(300);           // same 60% as the rest of the last hour
    expect(r.refund).toBe(200);
    expect(r.driver_share).toBe(150);  // 30% of 500
    expect(r.platform_share).toBe(150);
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
  // Deliberately the same 40% a rider gets for cancelling inside the hour:
  // simply not turning up should not be cheaper than saying so.
  it('splits 40 / 30 / 30 between rider, driver and platform', () => {
    const r = noShowOutcome(500);
    expect(r.refund).toBe(200);
    expect(r.driver_share).toBe(150);
    expect(r.platform_share).toBe(150);
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

describe('the driver share never comes out of the rider refund', () => {
  // The one way this arithmetic can go wrong is a driver percentage set above
  // its tier's fee, which would fund the driver from money already promised
  // back to the rider. Every tier, every fare.
  const minutesPerTier = [600, 300, 180, 90, 30, 10, 0, -30];

  it('keeps the platform share non-negative at every tier', () => {
    for (const fare of [1, 7.5, 99.99, 500, 1234.56]) {
      for (const mins of minutesPerTier) {
        const r = cancellationOutcome(fare, mins);
        expect(r.platform_share).toBeGreaterThanOrEqual(0);
        expect(r.driver_share).toBeLessThanOrEqual(r.fee + 0.001);
      }
    }
  });

  it('never returns more than the fare between refund, driver and platform', () => {
    for (const fare of [1, 7.5, 99.99, 500, 1234.56]) {
      for (const mins of minutesPerTier) {
        const r = cancellationOutcome(fare, mins);
        expect(r.refund + r.driver_share + r.platform_share).toBeCloseTo(fare, 2);
      }
    }
  });

  it('compensates the driver more the later the cancellation', () => {
    const at = (mins: number) => cancellationOutcome(1000, mins).driver_share;
    expect(at(300)).toBe(0);      // 4h+, no fee at all
    expect(at(180)).toBe(100);    // 2-4h, 10%
    expect(at(90)).toBe(150);     // 1-2h, 15%
    expect(at(30)).toBe(200);     // under 1h, 20%
    expect(at(10)).toBe(300);     // under 15m, 30%
    // Monotonic: a later cancellation must never pay the driver less.
    const shares = [300, 180, 90, 30, 10].map(at);
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeGreaterThanOrEqual(shares[i - 1]);
    }
  });
});
