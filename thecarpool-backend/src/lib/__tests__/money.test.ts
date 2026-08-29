import { round2, toPaise, fromPaise, isAtLeast, isShortOf, equals, sum, subtract } from '../money';

describe('round2', () => {
  it('rounds to paise', () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
  });

  it('rounds a .xx5 boundary up, despite how it is stored', () => {
    // 1.005 is actually held as 1.00499999999999989, so a naive
    // Math.round(n * 100) / 100 gives 1.00. The EPSILON nudge is what makes
    // this behave the way someone reading the number expects.
    expect(round2(1.005)).toBe(1.01);
  });

  it('leaves whole rupees alone', () => {
    expect(round2(250)).toBe(250);
  });
});

describe('toPaise / fromPaise', () => {
  it('converts rupees to integer paise', () => {
    expect(toPaise(1.99)).toBe(199);
    expect(toPaise(250)).toBe(25000);
  });

  it('survives the classic float case', () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(toPaise(0.1 + 0.2)).toBe(30);
  });

  it('round-trips', () => {
    expect(fromPaise(toPaise(1234.56))).toBe(1234.56);
  });

  it('refuses values that are not money', () => {
    // A silent 0 would read as "free" and could release a seat or a payout
    // for nothing, so this must throw rather than coerce.
    expect(() => toPaise(NaN)).toThrow();
    expect(() => toPaise(Infinity)).toThrow();
  });
});

describe('isAtLeast', () => {
  it('accepts an exact payment', () => {
    expect(isAtLeast(250, 250)).toBe(true);
  });

  it('accepts an exact payment assembled from parts that drift', () => {
    // The reason the old slack existed. 1.1 + 2.2 is 3.3000000000000003, so
    // a plain `paid >= due` against 3.3 is comparing two different numbers
    // that are the same amount of money.
    const due = 3.3;
    const paid = 1.1 + 2.2;
    expect(paid).not.toBe(due);
    expect(isAtLeast(paid, due)).toBe(true);
  });

  it('accepts a payment that drifts a hair BELOW the amount due', () => {
    // The direction that actually broke: a sum landing fractionally short of
    // the total is still the correct payment and must not be rejected.
    const due = 0.3;
    const paid = 0.1 + 0.1 + 0.1 - 0.00000000000000003;
    expect(isAtLeast(paid, due)).toBe(true);
  });

  it('REJECTS a payment one paisa short', () => {
    // The old `paid + 0.01 >= due` returned true here, accepting a genuine
    // underpayment. This is the case that regression matters most for.
    expect(isAtLeast(249.99, 250)).toBe(false);
    expect(isShortOf(249.99, 250)).toBe(true);
  });

  it('accepts an overpayment', () => {
    expect(isAtLeast(250.01, 250)).toBe(true);
  });

  it('treats zero due as always satisfied', () => {
    expect(isAtLeast(0, 0)).toBe(true);
  });
});

describe('equals', () => {
  it('sees through float drift', () => {
    expect(equals(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('still distinguishes a real difference', () => {
    expect(equals(0.3, 0.31)).toBe(false);
  });
});

describe('sum / subtract', () => {
  it('adds without accumulating drift', () => {
    expect(sum(0.1, 0.2)).toBe(0.3);
    expect(sum(100.1, 100.2, 49.7)).toBe(250);
  });

  it('stays exact over a long chain', () => {
    const tenth = Array(10).fill(0.1);
    expect(sum(...tenth)).toBe(1);
  });

  it('subtracts exactly', () => {
    expect(subtract(0.3, 0.1)).toBe(0.2);
    expect(subtract(250, 249.99)).toBe(0.01);
  });

  it('sums nothing to nothing', () => {
    expect(sum()).toBe(0);
  });
});
