import { describe, expect, it } from 'vitest';
import {
  CouponAlreadyAppliedError,
  CouponAlreadyUsedError,
  CouponExpiredError,
  CouponMinOrderNotMetError,
  CouponNotFoundError,
} from './coupon.errors';
import { revalidateOnConfirm, validateOnApply } from './coupon.rules';
import type { Coupon } from './coupon.types';

const now = new Date('2026-06-01T12:00:00.000Z');

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 1,
    code: 'DESC10',
    type: 'percentage',
    value: 10,
    minOrderCents: 0,
    expiresAt: new Date('2099-12-31T23:59:59.000Z'),
    usedAt: null,
    ...overrides,
  };
}

const apply = (
  coupon: Coupon | null,
  extra: { cartCouponId?: number | null; subtotalCents?: number } = {},
) => validateOnApply({ coupon, cartCouponId: null, subtotalCents: 5000, now, ...extra });

describe('validateOnApply', () => {
  it('accepts a valid coupon', () => {
    expect(() => apply(makeCoupon())).not.toThrow();
  });

  it('fails with COUPON_NOT_FOUND when the coupon does not exist', () => {
    expect(() => apply(null)).toThrow(CouponNotFoundError);
  });

  it('fails with COUPON_ALREADY_APPLIED when the cart already has a coupon', () => {
    expect(() => apply(makeCoupon(), { cartCouponId: 7 })).toThrow(CouponAlreadyAppliedError);
  });

  it('fails with COUPON_EXPIRED when expiry is in the past', () => {
    const coupon = makeCoupon({ expiresAt: new Date(now.getTime() - 1) });
    expect(() => apply(coupon)).toThrow(CouponExpiredError);
  });

  it('is still valid at the exact expiry instant', () => {
    expect(() => apply(makeCoupon({ expiresAt: new Date(now.getTime()) }))).not.toThrow();
  });

  it('fails with COUPON_ALREADY_USED when the coupon was consumed', () => {
    expect(() => apply(makeCoupon({ usedAt: new Date('2026-01-01') }))).toThrow(
      CouponAlreadyUsedError,
    );
  });

  it('fails with COUPON_MIN_ORDER_NOT_MET below the minimum', () => {
    const coupon = makeCoupon({ minOrderCents: 20000 });
    expect(() => apply(coupon, { subtotalCents: 19999 })).toThrow(CouponMinOrderNotMetError);
  });

  it('accepts a subtotal equal to the minimum', () => {
    expect(() =>
      apply(makeCoupon({ minOrderCents: 20000 }), { subtotalCents: 20000 }),
    ).not.toThrow();
  });

  it('treats a minimum of 0 as no minimum, even with an empty subtotal', () => {
    expect(() => apply(makeCoupon({ minOrderCents: 0 }), { subtotalCents: 0 })).not.toThrow();
  });

  describe('check order (RN-010)', () => {
    const past = new Date(now.getTime() - 1000);

    it('reports a missing coupon before anything else', () => {
      expect(() => apply(null, { cartCouponId: 7 })).toThrow(CouponNotFoundError);
    });

    it('reports ALREADY_APPLIED before expired, used and minimum', () => {
      const coupon = makeCoupon({ expiresAt: past, usedAt: past, minOrderCents: 99999 });
      expect(() => apply(coupon, { cartCouponId: 7 })).toThrow(CouponAlreadyAppliedError);
    });

    it('reports EXPIRED before used and minimum', () => {
      const coupon = makeCoupon({ expiresAt: past, usedAt: past, minOrderCents: 99999 });
      expect(() => apply(coupon)).toThrow(CouponExpiredError);
    });

    it('reports USED before the minimum', () => {
      const coupon = makeCoupon({ usedAt: past, minOrderCents: 99999 });
      expect(() => apply(coupon)).toThrow(CouponAlreadyUsedError);
    });
  });

  it('exposes the documented codes and statuses', () => {
    expect(new CouponNotFoundError()).toMatchObject({ code: 'COUPON_NOT_FOUND', status: 404 });
    expect(new CouponAlreadyAppliedError()).toMatchObject({
      code: 'COUPON_ALREADY_APPLIED',
      status: 409,
    });
    expect(new CouponExpiredError()).toMatchObject({ code: 'COUPON_EXPIRED', status: 422 });
    expect(new CouponAlreadyUsedError()).toMatchObject({
      code: 'COUPON_ALREADY_USED',
      status: 422,
    });
    expect(new CouponMinOrderNotMetError()).toMatchObject({
      code: 'COUPON_MIN_ORDER_NOT_MET',
      status: 422,
    });
  });
});

describe('revalidateOnConfirm', () => {
  const confirm = (coupon: Coupon | null, subtotalCents = 5000) =>
    revalidateOnConfirm({ coupon, subtotalCents, now });

  it('accepts a coupon that is still valid', () => {
    expect(() => confirm(makeCoupon())).not.toThrow();
  });

  it('fails with COUPON_NOT_FOUND when the coupon disappeared', () => {
    expect(() => confirm(null)).toThrow(CouponNotFoundError);
  });

  it('fails with COUPON_EXPIRED when it expired after being applied', () => {
    expect(() => confirm(makeCoupon({ expiresAt: new Date(now.getTime() - 1) }))).toThrow(
      CouponExpiredError,
    );
  });

  it('fails with COUPON_ALREADY_USED when another cart consumed it first', () => {
    expect(() => confirm(makeCoupon({ usedAt: now }))).toThrow(CouponAlreadyUsedError);
  });

  it('fails with COUPON_MIN_ORDER_NOT_MET when the subtotal dropped below the minimum', () => {
    expect(() => confirm(makeCoupon({ minOrderCents: 20000 }), 1000)).toThrow(
      CouponMinOrderNotMetError,
    );
  });

  it('keeps the order expired -> used -> minimum', () => {
    const past = new Date(now.getTime() - 1000);
    expect(() =>
      confirm(makeCoupon({ expiresAt: past, usedAt: past, minOrderCents: 99999 })),
    ).toThrow(CouponExpiredError);
    expect(() => confirm(makeCoupon({ usedAt: past, minOrderCents: 99999 }))).toThrow(
      CouponAlreadyUsedError,
    );
  });
});
