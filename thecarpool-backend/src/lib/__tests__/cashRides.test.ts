import {
  CASH_RIDE_LIMIT,
  consumesAllowance,
  cashAllowance,
  cashBookingRefusal,
  isBookingActive,
} from '../cashRides';

describe('what consumes a pay-the-driver allowance', () => {
  it('counts a live cash booking', () => {
    expect(consumesAllowance({ payment_method: 'PAY_DRIVER', booking_status: 'CONFIRMED' })).toBe(true);
  });

  it('counts one still awaiting the driver', () => {
    expect(consumesAllowance({ payment_method: 'PAY_DRIVER', booking_status: 'REQUESTED' })).toBe(true);
  });

  it('counts a completed one', () => {
    expect(consumesAllowance({ payment_method: 'PAY_DRIVER', booking_status: 'COMPLETED' })).toBe(true);
  });

  // A driver's refusal must not cost the rider one of their five: they never
  // travelled, and they had no say in it.
  it('does NOT count a request the driver declined', () => {
    expect(consumesAllowance({ payment_method: 'PAY_DRIVER', booking_status: 'DECLINED' })).toBe(false);
  });

  it('does NOT count one that was cancelled', () => {
    expect(consumesAllowance({ payment_method: 'PAY_DRIVER', escrow_status: 'CANCELLED' })).toBe(false);
  });

  it('ignores bookings paid for through the app', () => {
    expect(consumesAllowance({ payment_method: 'RAZORPAY', booking_status: 'CONFIRMED' })).toBe(false);
    expect(consumesAllowance({ payment_method: 'WALLET', booking_status: 'CONFIRMED' })).toBe(false);
  });

  it('ignores a booking with no payment method recorded', () => {
    expect(consumesAllowance({ booking_status: 'CONFIRMED' })).toBe(false);
  });
});

describe('cashAllowance', () => {
  const cash = (n: number) =>
    Array.from({ length: n }, () => ({ payment_method: 'PAY_DRIVER', booking_status: 'CONFIRMED' }));

  it('gives a brand new rider the full allowance', () => {
    const a = cashAllowance([]);
    expect(a.limit).toBe(CASH_RIDE_LIMIT);
    expect(a.used).toBe(0);
    expect(a.remaining).toBe(CASH_RIDE_LIMIT);
    expect(a.eligible).toBe(true);
  });

  it('counts down as they are used', () => {
    expect(cashAllowance(cash(3)).remaining).toBe(CASH_RIDE_LIMIT - 3);
  });

  it('stops at the limit', () => {
    const a = cashAllowance(cash(CASH_RIDE_LIMIT));
    expect(a.remaining).toBe(0);
    expect(a.eligible).toBe(false);
  });

  // The counter is derived, so it can never go negative or wrap round even if
  // more cash bookings somehow exist than the limit allows.
  it('never reports a negative remainder', () => {
    const a = cashAllowance(cash(CASH_RIDE_LIMIT + 4));
    expect(a.remaining).toBe(0);
    expect(a.eligible).toBe(false);
  });

  it('hands the allowance back when a booking is declined or cancelled', () => {
    const mixed = [
      ...cash(CASH_RIDE_LIMIT),
      { payment_method: 'PAY_DRIVER', booking_status: 'DECLINED' },
      { payment_method: 'PAY_DRIVER', escrow_status: 'CANCELLED' },
    ];
    // The two dead ones do not add to the count.
    expect(cashAllowance(mixed).used).toBe(CASH_RIDE_LIMIT);

    const withRefusals = [
      ...cash(2),
      { payment_method: 'PAY_DRIVER', booking_status: 'DECLINED' },
    ];
    expect(cashAllowance(withRefusals).remaining).toBe(CASH_RIDE_LIMIT - 2);
  });

  it('is not affected by rides paid for through the app', () => {
    const paid = Array.from({ length: 20 }, () => ({
      payment_method: 'RAZORPAY', booking_status: 'COMPLETED',
    }));
    expect(cashAllowance(paid).remaining).toBe(CASH_RIDE_LIMIT);
  });
});

describe('cashBookingRefusal', () => {
  it('allows a single seat while allowance remains', () => {
    expect(cashBookingRefusal(cashAllowance([]), 1)).toBeNull();
  });

  it('refuses once the allowance is spent, and says so', () => {
    const spent = cashAllowance(
      Array.from({ length: CASH_RIDE_LIMIT }, () => ({
        payment_method: 'PAY_DRIVER', booking_status: 'CONFIRMED',
      }))
    );
    const reason = cashBookingRefusal(spent, 1);
    expect(reason).toContain(String(CASH_RIDE_LIMIT));
    expect(reason).toContain('Pay through the app');
  });

  // Booking four seats on a trust allowance hands three strangers an unfunded
  // seat that the driver carries the risk on.
  it('refuses more than one seat', () => {
    expect(cashBookingRefusal(cashAllowance([]), 2)).toContain('one seat');
  });
});

describe('isBookingActive', () => {
  // The audit that produced this: boarding verification and cancellation both
  // tested `escrow_status === 'HELD'` to mean "this seat is real". For a cash
  // booking that is false while the rider is entirely real, so verifying them
  // aboard was impossible and cancelling was refused -- they would have been
  // stuck in a booking they could not leave or complete.
  it('treats an escrowed booking as active', () => {
    expect(isBookingActive('HELD')).toBe(true);
  });

  it('treats a pay-the-driver booking as active even though nothing is held', () => {
    expect(isBookingActive('NONE')).toBe(true);
  });

  it('treats a finished or cancelled booking as inactive', () => {
    expect(isBookingActive('SETTLED')).toBe(false);
    expect(isBookingActive('CANCELLED')).toBe(false);
    expect(isBookingActive('REFUNDED')).toBe(false);
  });

  it('treats missing state as inactive rather than guessing', () => {
    expect(isBookingActive(undefined)).toBe(false);
    expect(isBookingActive(null)).toBe(false);
    expect(isBookingActive('')).toBe(false);
  });
});
