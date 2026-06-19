import { describe, it, expect } from 'vitest';
import { calculateSplit, suggestPricing, fuelSavings } from '../pricing';

describe('calculateSplit', () => {
  it('splits a fare evenly across passengers with no group discount for a single seat', () => {
    const r = calculateSplit(300, 3, 1);
    expect(r.original_split_per_passenger).toBe(100);
    expect(r.discount_applied).toBe(false);
    expect(r.discount_amount).toBe(0);
    expect(r.final_split_charge).toBe(100);
  });

  it('applies a 15% group discount when more than one seat is booked', () => {
    const r = calculateSplit(300, 3, 2);
    expect(r.discount_applied).toBe(true);
    expect(r.discount_amount).toBe(15); // 15% of 100
    expect(r.final_split_charge).toBe(170); // (100 - 15) * 2
  });

  it('never divides by zero — a zero passenger count is clamped to 1', () => {
    const r = calculateSplit(300, 0, 1);
    expect(Number.isFinite(r.original_split_per_passenger)).toBe(true);
    expect(r.original_split_per_passenger).toBe(300);
  });

  it('clamps negative fares to zero rather than producing negative charges', () => {
    const r = calculateSplit(-500, 2, 1);
    expect(r.final_split_charge).toBe(0);
  });
});

describe('suggestPricing', () => {
  it('charges the AC premium for an AC car', () => {
    const r = suggestPricing(10, 'CAR', true);
    expect(r.rate_per_km).toBe(14); // 12 base + 2 AC
    expect(r.suggested_total_compensation).toBe(140);
  });

  it('omits the AC premium for a bike', () => {
    const r = suggestPricing(10, 'BIKE', true);
    expect(r.rate_per_km).toBe(6);
    expect(r.suggested_total_compensation).toBe(60);
  });

  it('handles a zero-length route without NaN', () => {
    const r = suggestPricing(0, 'CAR', false);
    expect(r.suggested_total_compensation).toBe(0);
  });
});

describe('fuelSavings', () => {
  it('computes the taxi-vs-carpool delta', () => {
    const r = fuelSavings(100);
    expect(r.equivalent_taxi_cost).toBe(1200);
    expect(r.thecarpool_cost).toBe(400);
    expect(r.total_fuel_saved_inr).toBe(800);
  });

  it('returns zeros for non-finite input', () => {
    const r = fuelSavings(NaN);
    expect(r.total_fuel_saved_inr).toBe(0);
    expect(r.prevented_fuel_liters).toBe(0);
  });
});
