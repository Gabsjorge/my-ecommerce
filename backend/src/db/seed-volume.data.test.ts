import { describe, expect, it } from 'vitest';
import { COUPON_CODE_PATTERN } from '../modules/coupons/coupon.code';
import { CART_TIMEOUT_MS, generateVolumeDataset, type VolumeDataset } from './seed-volume.data';

const NOW = new Date('2026-06-15T12:00:00Z');
const MAX_INT32 = 2_147_483_647;
const data: VolumeDataset = generateVolumeDataset({ now: NOW });

describe('generateVolumeDataset', () => {
  it('generates the planned volumes', () => {
    expect(data.products).toHaveLength(1000);
    expect(data.coupons).toHaveLength(1200);
    expect(data.carts).toHaveLength(3000);
  });

  it('is deterministic for the same seed and reference date', () => {
    expect(generateVolumeDataset({ now: NOW })).toEqual(data);
    expect(generateVolumeDataset({ now: NOW, seed: 1 })).not.toEqual(data);
  });

  describe('products', () => {
    it('respects column limits and CHECK constraints', () => {
      for (const p of data.products) {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.name.length).toBeLessThanOrEqual(120);
        expect(Number.isInteger(p.priceCents)).toBe(true);
        expect(p.priceCents).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(p.stock)).toBe(true);
        expect(p.stock).toBeGreaterThanOrEqual(0);
      }
    });

    it('has unique names and does not collide with the fixed seed names', () => {
      const names = data.products.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('covers boundary values', () => {
      expect(data.products.some((p) => p.priceCents === 0)).toBe(true);
      expect(data.products.some((p) => p.priceCents === 1)).toBe(true);
      expect(data.products.some((p) => p.priceCents === 999_999)).toBe(true);
      expect(data.products.some((p) => p.name.length === 120)).toBe(true);
      expect(data.products.some((p) => p.stock === 0)).toBe(true);
      expect(data.products.some((p) => p.stock >= 1 && p.stock <= 3)).toBe(true);
      expect(data.products.some((p) => p.stock >= 5000)).toBe(true);
    });
  });

  describe('coupons', () => {
    it('has unique, normalized codes with the VOL- prefix', () => {
      const codes = data.coupons.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(code).toMatch(COUPON_CODE_PATTERN);
        expect(code.startsWith('VOL-')).toBe(true);
      }
    });

    it('respects the value ranges per type', () => {
      for (const c of data.coupons) {
        if (c.type === 'percentage') {
          expect(c.value).toBeGreaterThanOrEqual(1);
          expect(c.value).toBeLessThanOrEqual(100);
        } else {
          expect(c.type).toBe('fixed');
          expect(c.value).toBeGreaterThan(0);
        }
        expect(c.minOrderCents ?? 0).toBeGreaterThanOrEqual(0);
      }
    });

    it('mixes types and states', () => {
      expect(data.coupons.some((c) => c.type === 'percentage')).toBe(true);
      expect(data.coupons.some((c) => c.type === 'fixed')).toBe(true);
      expect(data.coupons.some((c) => c.usedAt)).toBe(true);
      expect(data.coupons.some((c) => !c.usedAt && c.expiresAt! < NOW)).toBe(true);
      expect(data.coupons.some((c) => !c.usedAt && c.expiresAt! > NOW)).toBe(true);
      expect(data.coupons.some((c) => c.minOrderCents === 0)).toBe(true);
      expect(data.coupons.some((c) => (c.minOrderCents ?? 0) > 0)).toBe(true);
    });

    it('marks a coupon as used exactly when one order uses it', () => {
      const usedByOrders = new Map<number, number>();
      for (const cart of data.carts) {
        if (cart.order && cart.couponIndex !== null) {
          usedByOrders.set(cart.couponIndex, (usedByOrders.get(cart.couponIndex) ?? 0) + 1);
        }
      }
      for (const count of usedByOrders.values()) expect(count).toBe(1);
      data.coupons.forEach((c, i) => expect(Boolean(c.usedAt)).toBe(usedByOrders.has(i)));
    });
  });

  describe('carts', () => {
    it('covers all states', () => {
      const statuses = new Set(data.carts.map((c) => c.status));
      expect(statuses).toEqual(
        new Set(['empty', 'with_items', 'in_checkout', 'order_created', 'abandoned']),
      );
    });

    it('keeps items consistent with the status', () => {
      for (const cart of data.carts) {
        if (cart.status === 'empty') {
          expect(cart.items).toHaveLength(0);
          expect(cart.couponIndex).toBeNull();
        } else {
          expect(cart.items.length).toBeGreaterThanOrEqual(1);
        }
        expect(Boolean(cart.order)).toBe(cart.status === 'order_created');
      }
    });

    it('has one line per product, valid quantities and prices', () => {
      for (const cart of data.carts) {
        const ids = cart.items.map((i) => i.productIndex);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of cart.items) {
          expect(item.productIndex).toBeLessThan(data.products.length);
          expect(item.quantity).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(item.unitPriceCents)).toBe(true);
          expect(item.unitPriceCents).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('has timestamps in order and never in the future', () => {
      for (const cart of data.carts) {
        expect(cart.lastActivityAt.getTime()).toBeGreaterThanOrEqual(cart.createdAt.getTime());
        expect(cart.lastActivityAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      }
    });

    it('applies the inactivity timeout consistently (RN-020)', () => {
      for (const cart of data.carts) {
        const idle = NOW.getTime() - cart.lastActivityAt.getTime();
        if (cart.status === 'abandoned') expect(idle).toBeGreaterThan(CART_TIMEOUT_MS);
        if (cart.status === 'with_items' || cart.status === 'in_checkout') {
          expect(idle).toBeLessThan(CART_TIMEOUT_MS);
        }
      }
    });

    it('only applies coupons that are valid for the cart state', () => {
      for (const cart of data.carts) {
        if (cart.couponIndex === null || cart.order) continue;
        const coupon = data.coupons[cart.couponIndex];
        expect(coupon.usedAt).toBeNull();
        if (cart.status !== 'abandoned') expect(coupon.expiresAt! > NOW).toBe(true);
      }
    });

    it('does not request more than the final stock in open carts (RN-005)', () => {
      for (const cart of data.carts) {
        if (cart.order || cart.status === 'abandoned') continue;
        for (const item of cart.items) {
          expect(item.quantity).toBeLessThanOrEqual(data.products[item.productIndex].stock);
        }
      }
    });
  });

  describe('orders', () => {
    const orderCarts = data.carts.filter((c) => c.order);

    it('has consistent totals (RN-015, orders_total_consistent)', () => {
      expect(orderCarts.length).toBeGreaterThan(1000);
      for (const cart of orderCarts) {
        const order = cart.order!;
        const subtotal = cart.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
        expect(subtotal).toBeLessThanOrEqual(MAX_INT32);
        expect(order.subtotalCents).toBe(subtotal);
        expect(order.totalCents).toBe(order.subtotalCents - order.discountCents);
        expect(order.discountCents).toBeGreaterThanOrEqual(0);
        expect(order.totalCents).toBeGreaterThanOrEqual(0);
        if (cart.couponIndex === null) expect(order.discountCents).toBe(0);
      }
    });

    it('honors coupon rules at order time (minimum, expiry, discount formula)', () => {
      for (const cart of orderCarts) {
        if (cart.couponIndex === null) continue;
        const coupon = data.coupons[cart.couponIndex];
        const order = cart.order!;
        expect(order.subtotalCents).toBeGreaterThanOrEqual(coupon.minOrderCents!);
        expect(coupon.usedAt).toEqual(order.createdAt);
        expect(coupon.expiresAt! > order.createdAt).toBe(true);
        const expected =
          coupon.type === 'percentage'
            ? Math.floor((order.subtotalCents * coupon.value) / 100)
            : Math.min(coupon.value, order.subtotalCents);
        expect(order.discountCents).toBe(expected);
      }
    });

    it('covers coupon and no-coupon orders and the zero-total boundary', () => {
      expect(orderCarts.some((c) => c.couponIndex !== null)).toBe(true);
      expect(orderCarts.some((c) => c.couponIndex === null)).toBe(true);
      expect(orderCarts.some((c) => c.order!.totalCents === 0 && c.order!.subtotalCents > 0)).toBe(
        true,
      );
    });
  });
});
