import { describe, expect, it } from 'vitest';
import { seedCoupons, seedProducts } from './seed';

describe('seedProducts', () => {
  it('has 10 products', () => {
    expect(seedProducts).toHaveLength(10);
  });

  it('has non-negative integer priceCents and stock', () => {
    for (const product of seedProducts) {
      expect(Number.isInteger(product.priceCents)).toBe(true);
      expect(product.priceCents).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(product.stock)).toBe(true);
      expect(product.stock).toBeGreaterThanOrEqual(0);
    }
  });

  it('has unique names that fit the column', () => {
    const names = seedProducts.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(120);
  });

  it('has exactly one product out of stock (UI badge assertions rely on it)', () => {
    expect(seedProducts.filter((p) => p.stock === 0)).toHaveLength(1);
  });

  it('has the dedicated cart-test products with the documented price and stock', () => {
    const byName = new Map(seedProducts.map((p) => [p.name, p]));
    expect(byName.get('Caneta Esferográfica Azul (Estoque Alto)')).toMatchObject({
      priceCents: 1000,
      stock: 1000,
    });
    expect(byName.get('Edição Limitada Caderno Artesanal (Último Item)')).toMatchObject({
      priceCents: 2500,
      stock: 1,
    });
    expect(byName.get('Mochila Escolar Compacta (Estoque Limitado)')).toMatchObject({
      priceCents: 1500,
      stock: 3,
    });
    expect(byName.get('Agenda Anual Última Unidade (UI)')).toMatchObject({
      priceCents: 2500,
      stock: 1,
    });
  });

  it('does not set explicit ids (generated always as identity)', () => {
    expect(seedProducts.some((p) => 'id' in p)).toBe(false);
  });
});

describe('seedCoupons', () => {
  const byCode = (code: string) => seedCoupons.find((c) => c.code === code);

  it('has 13 coupons with unique, normalized codes (RN-014)', () => {
    expect(seedCoupons).toHaveLength(13);
    const codes = seedCoupons.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9_-]{3,30}$/);
  });

  it('respects the database constraints on type, value and minimum', () => {
    for (const coupon of seedCoupons) {
      if (coupon.type === 'percentage') {
        expect(coupon.value).toBeGreaterThanOrEqual(1);
        expect(coupon.value).toBeLessThanOrEqual(100);
      } else {
        expect(coupon.type).toBe('fixed');
        expect(coupon.value).toBeGreaterThan(0);
      }
      expect(Number.isInteger(coupon.value)).toBe(true);
      expect(coupon.minOrderCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('covers percentage, fixed, expired, minimum order and used coupons', () => {
    expect(seedCoupons.some((c) => c.type === 'percentage')).toBe(true);
    expect(seedCoupons.some((c) => c.type === 'fixed')).toBe(true);
    expect(byCode('EXPIRADO10')?.expiresAt).toEqual(new Date('2020-01-01T00:00:00Z'));
    expect(byCode('MIN200')?.minOrderCents).toBe(20000);
    expect(byCode('USADO10')?.usedAt).toBeInstanceOf(Date);
  });

  it('leaves every other coupon unused and not expired', () => {
    const now = new Date();
    for (const coupon of seedCoupons) {
      if (coupon.code === 'USADO10') continue;
      expect(coupon.usedAt ?? null).toBeNull();
      if (coupon.code !== 'EXPIRADO10')
        expect(coupon.expiresAt.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('keeps the fixed coupon above any test subtotal', () => {
    expect(byCode('FIXO5000')).toMatchObject({ type: 'fixed', value: 500000 });
    expect(byCode('MEGA100')).toMatchObject({ type: 'percentage', value: 100 });
  });
});
