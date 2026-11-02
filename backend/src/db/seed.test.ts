import { describe, expect, it } from 'vitest';
import { seedProducts } from './seed';

describe('seedProducts', () => {
  it('has 6 products', () => {
    expect(seedProducts).toHaveLength(6);
  });

  it('has non-negative integer priceCents and stock', () => {
    for (const product of seedProducts) {
      expect(Number.isInteger(product.priceCents)).toBe(true);
      expect(product.priceCents).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(product.stock)).toBe(true);
      expect(product.stock).toBeGreaterThanOrEqual(0);
    }
  });

  it('has unique names', () => {
    const names = seedProducts.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has at least one product out of stock', () => {
    expect(seedProducts.some((p) => p.stock === 0)).toBe(true);
  });

  it('does not set explicit ids (generated always as identity)', () => {
    expect(seedProducts.some((p) => 'id' in p)).toBe(false);
  });
});
