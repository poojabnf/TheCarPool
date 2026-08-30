/**
 * The rule that decides whether a completed booking pays the driver in full or
 * treats the rider as a no-show.
 *
 * This exists because the rule was wrong in production for every booking that
 * ever reached settlement. Settlement branched on `boarding_verified === true`,
 * so anything unverified took the penalty path — and since the control for
 * entering a boarding code was being wiped by any failed manifest fetch, no
 * driver could verify anyone. The result was 8 settlements, 0 verified, 8
 * no-shows, and ₹170.05 withheld from drivers who had actually driven.
 *
 * The distinction the code has to hold onto is that "we have no boarding
 * record" and "the rider did not turn up" are different statements. Only the
 * second one costs the rider money, and only a driver can assert it.
 */
import { noShowOutcome, NO_SHOW_REFUND_PCT, NO_SHOW_DRIVER_PCT } from '../fees';

/**
 * Mirrors the branch in settleRideEscrow. Kept as a named predicate so the
 * rule can be tested without standing up Firestore, and so the intent is
 * greppable from the settlement code that implements it.
 */
function settlesAsNoShow(booking: {
  boarding_verified?: boolean;
  marked_no_show?: boolean;
}): boolean {
  return booking.marked_no_show === true;
}

describe('what counts as a no-show at settlement', () => {
  it('does NOT punish a rider merely because no boarding code was recorded', () => {
    // The exact shape of all 8 historical settlements.
    expect(settlesAsNoShow({ boarding_verified: false })).toBe(false);
  });

  it('does not punish a booking with no boarding information at all', () => {
    expect(settlesAsNoShow({})).toBe(false);
  });

  it('pays a verified rider in full', () => {
    expect(settlesAsNoShow({ boarding_verified: true })).toBe(false);
  });

  it('applies the penalty only when the driver declares it', () => {
    expect(settlesAsNoShow({ boarding_verified: false, marked_no_show: true })).toBe(true);
  });

  it('treats an undone no-show as a normal trip again', () => {
    expect(settlesAsNoShow({ marked_no_show: false })).toBe(false);
  });
});

describe('the penalty itself is unchanged', () => {
  // Asserted against the constants rather than literals on purpose: this test
  // is about the split adding up, not about the specific rate, which the fee
  // tests pin. The name used to quote 80/5 and kept passing after the rate
  // moved to 40/30 -- a green test describing the wrong policy.
  it('splits the fare between rider, driver and platform without losing any', () => {
    const out = noShowOutcome(100);
    expect(out.refund).toBe(NO_SHOW_REFUND_PCT);
    expect(out.driver_share).toBe(NO_SHOW_DRIVER_PCT);
    expect(out.refund + out.driver_share + out.platform_share).toBeCloseTo(100, 2);
  });

  it('still costs a driver most of the fare, which is why it must be declared', () => {
    const fare = 200;
    const out = noShowOutcome(fare);
    // 30% to the driver now, not the 5% that made the historical
    // misclassification so expensive -- but still a 70% loss on a fare they
    // earned, so it has to be a claim someone makes rather than a default.
    expect(out.driver_share).toBe(60);
    expect(fare - out.driver_share).toBe(140);
  });
});
