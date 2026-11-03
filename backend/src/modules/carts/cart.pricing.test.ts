import { describe, expect, it } from 'vitest';
import { FIXED_ROUNDING_CASES, PERCENTAGE_ROUNDING_CASES } from '../../test-support/rounding-cases';
import { computeTotals, discountCents, subtotalCents } from './cart.pricing';

describe('subtotalCents', () => {
  it('sums unit price times quantity over all lines', () => {
    const lines = [
      { unitPriceCents: 1000, quantity: 2 },
      { unitPriceCents: 250, quantity: 3 },
    ];
    expect(subtotalCents(lines)).toBe(2750);
  });

  it('is 0 for a cart without lines', () => {
    expect(subtotalCents([])).toBe(0);
  });
});

describe('discountCents', () => {
  it('rounds a percentage discount down to whole cents', () => {
    expect(discountCents({ type: 'percentage', value: 10 }, 999)).toBe(99);
    expect(discountCents({ type: 'percentage', value: 15 }, 1001)).toBe(150);
  });

  it('gives a 100% coupon the whole subtotal', () => {
    expect(discountCents({ type: 'percentage', value: 100 }, 12345)).toBe(12345);
  });

  it('applies a fixed discount as is when it is below the subtotal', () => {
    expect(discountCents({ type: 'fixed', value: 2000 }, 5000)).toBe(2000);
  });

  it('caps a fixed discount at the subtotal', () => {
    expect(discountCents({ type: 'fixed', value: 500000 }, 3000)).toBe(3000);
  });

  it('is 0 without a coupon', () => {
    expect(discountCents(null, 5000)).toBe(0);
  });

  it('is 0 when the subtotal is 0', () => {
    expect(discountCents({ type: 'fixed', value: 2000 }, 0)).toBe(0);
    expect(discountCents({ type: 'percentage', value: 50 }, 0)).toBe(0);
  });
});

describe('computeTotals', () => {
  const lines = [{ unitPriceCents: 1000, quantity: 3 }];

  it('returns subtotal, discount and total = subtotal - discount', () => {
    expect(computeTotals(lines, { type: 'percentage', value: 10 })).toEqual({
      subtotalCents: 3000,
      discountCents: 300,
      totalCents: 2700,
    });
  });

  it('has no discount without a coupon', () => {
    expect(computeTotals(lines, null)).toEqual({
      subtotalCents: 3000,
      discountCents: 0,
      totalCents: 3000,
    });
  });

  it('zeroes the total with a 100% coupon', () => {
    expect(computeTotals(lines, { type: 'percentage', value: 100 }).totalCents).toBe(0);
  });

  it('never goes negative when a fixed coupon exceeds the subtotal', () => {
    expect(computeTotals(lines, { type: 'fixed', value: 500000 })).toEqual({
      subtotalCents: 3000,
      discountCents: 3000,
      totalCents: 0,
    });
  });

  it('keeps the discount computed on the current subtotal after the cart shrinks', () => {
    const smaller = [{ unitPriceCents: 1000, quantity: 1 }];
    expect(computeTotals(smaller, { type: 'percentage', value: 15 })).toEqual({
      subtotalCents: 1000,
      discountCents: 150,
      totalCents: 850,
    });
  });

  it('returns zeros for an empty cart even with a coupon', () => {
    expect(computeTotals([], { type: 'fixed', value: 2000 })).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });
});

describe('discountCents boundary tables (RN-015)', () => {
  it.each(PERCENTAGE_ROUNDING_CASES)('percentage: $name', (c) => {
    expect(discountCents({ type: 'percentage', value: c.percent }, c.subtotalCents)).toBe(
      c.expectedDiscountCents,
    );
  });

  it.each(FIXED_ROUNDING_CASES)('fixed: $name', (c) => {
    expect(discountCents({ type: 'fixed', value: c.valueCents }, c.subtotalCents)).toBe(
      c.expectedDiscountCents,
    );
  });

  it.each(PERCENTAGE_ROUNDING_CASES)('total is never negative: $name', (c) => {
    const totals = computeTotals([{ unitPriceCents: c.subtotalCents, quantity: 1 }], {
      type: 'percentage',
      value: c.percent,
    });
    expect(totals.totalCents).toBe(c.subtotalCents - c.expectedDiscountCents);
    expect(totals.totalCents).toBeGreaterThanOrEqual(0);
  });
});
