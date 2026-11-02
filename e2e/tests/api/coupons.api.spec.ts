import { expect, test } from '@playwright/test';
import {
  applyCoupon,
  cartInCheckout,
  cartWithItem,
  checkout,
  confirm,
  COUPON_CODES,
  createCart,
  edit,
  expectError,
  getCart,
  PRODUCT_NAMES,
  removeCoupon,
  updateItem,
} from '../../support/api';

// Only reusable coupons are applied successfully here, and no order is confirmed with them:
// the consumable coupons belong to checkout.api.spec.ts. Prices: highStock 1000, regular 4990.
test.describe('coupons API', () => {
  test.describe('discount calculation (RN-015)', () => {
    test('percentage coupon discounts the subtotal', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 3);
      const res = await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      expect(res.status).toBe(200);
      expect(res.body.coupon).toEqual({ code: 'DESC10', type: 'percentage', value: 10 });
      expect(res.body.subtotalCents).toBe(3000);
      expect(res.body.discountCents).toBe(300);
      expect(res.body.totalCents).toBe(2700);
    });

    test('percentage discount rounds down to whole cents', async ({ request }) => {
      // 5 x 4990 = 24950; 15% = 3742.5 -> 3742
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.regular, 5);
      const res = await applyCoupon(request, cart.id, { code: COUPON_CODES.minOrder });
      expect(res.status).toBe(200);
      expect(res.body.subtotalCents).toBe(24950);
      expect(res.body.discountCents).toBe(3742);
      expect(res.body.totalCents).toBe(21208);
    });

    test('fixed coupon subtracts its value', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 5);
      const res = await applyCoupon(request, cart.id, { code: COUPON_CODES.fixed });
      expect(res.status).toBe(200);
      expect(res.body.coupon).toEqual({ code: 'FIXO20', type: 'fixed', value: 2000 });
      expect(res.body.discountCents).toBe(2000);
      expect(res.body.totalCents).toBe(3000);
    });

    test('a 100% coupon zeroes the total', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
      const res = await applyCoupon(request, cart.id, { code: COUPON_CODES.full });
      expect(res.status).toBe(200);
      expect(res.body.discountCents).toBe(2000);
      expect(res.body.totalCents).toBe(0);
    });

    test('a fixed coupon above the subtotal is capped at the subtotal', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      const res = await applyCoupon(request, cart.id, { code: COUPON_CODES.fixedAboveSubtotal });
      expect(res.status).toBe(200);
      expect(res.body.discountCents).toBe(1000);
      expect(res.body.totalCents).toBe(0);
    });

    test('the discount follows the cart contents while the coupon stays applied', async ({
      request,
    }) => {
      const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      const res = await updateItem(request, cart.id, product.id, { quantity: 10 });
      expect(res.body.coupon?.code).toBe('DESC10');
      expect(res.body.subtotalCents).toBe(10000);
      expect(res.body.discountCents).toBe(1000);
      expect(res.body.totalCents).toBe(9000);
    });
  });

  test.describe('code format (RN-014)', () => {
    test('the code is trimmed and case-insensitive', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      const res = await applyCoupon(request, cart.id, { code: '  desc10 ' });
      expect(res.status).toBe(200);
      expect(res.body.coupon?.code).toBe('DESC10');
    });

    const invalidCodes: [string, unknown][] = [
      ['2 characters', 'ab'],
      ['31 characters', 'A'.repeat(31)],
      ['inner space', 'DESC 10'],
      ['special character', 'DESC@10'],
      ['blank', '   '],
      ['empty', ''],
      ['number', 123],
      ['null', null],
    ];

    for (const [label, code] of invalidCodes) {
      test(`${label} is 400 VALIDATION_ERROR and the cart stays unchanged`, async ({ request }) => {
        const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
        expectError(await applyCoupon(request, cart.id, { code }), 400, 'VALIDATION_ERROR');
        expect((await getCart(request, cart.id)).body).toEqual(cart);
      });
    }

    test('a missing code is 400 VALIDATION_ERROR', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(await applyCoupon(request, cart.id, {}), 400, 'VALIDATION_ERROR');
    });

    test('format is validated before the cart state (empty cart + invalid code is 400)', async ({
      request,
    }) => {
      const cart = await createCart(request);
      expectError(await applyCoupon(request, cart.body.id, { code: 'x' }), 400, 'VALIDATION_ERROR');
    });

    test('the minimum (3) and maximum (30) lengths pass the format check', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(await applyCoupon(request, cart.id, { code: 'ABC' }), 404, 'COUPON_NOT_FOUND');
      expectError(
        await applyCoupon(request, cart.id, { code: 'A'.repeat(30) }),
        404,
        'COUPON_NOT_FOUND',
      );
    });
  });

  test.describe('apply errors (RN-010)', () => {
    test('unknown coupon is 404 COUPON_NOT_FOUND', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(
        await applyCoupon(request, cart.id, { code: 'NAO-EXISTE' }),
        404,
        'COUPON_NOT_FOUND',
      );
    });

    test('expired coupon is 422 COUPON_EXPIRED', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(
        await applyCoupon(request, cart.id, { code: COUPON_CODES.expired }),
        422,
        'COUPON_EXPIRED',
      );
      expect((await getCart(request, cart.id)).body.coupon).toBeNull();
    });

    test('already used coupon is 422 COUPON_ALREADY_USED', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(
        await applyCoupon(request, cart.id, { code: COUPON_CODES.used }),
        422,
        'COUPON_ALREADY_USED',
      );
    });

    test('subtotal below the minimum is 422 COUPON_MIN_ORDER_NOT_MET', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 19);
      expectError(
        await applyCoupon(request, cart.id, { code: COUPON_CODES.minOrder }),
        422,
        'COUPON_MIN_ORDER_NOT_MET',
      );
      expect((await getCart(request, cart.id)).body.coupon).toBeNull();
    });

    test('subtotal exactly equal to the minimum is accepted', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 20);
      const res = await applyCoupon(request, cart.id, { code: COUPON_CODES.minOrder });
      expect(res.status).toBe(200);
      expect(res.body.discountCents).toBe(3000);
    });

    test('a second coupon is 409 COUPON_ALREADY_APPLIED', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      expectError(
        await applyCoupon(request, cart.id, { code: COUPON_CODES.fixed }),
        409,
        'COUPON_ALREADY_APPLIED',
      );
      expect((await getCart(request, cart.id)).body.coupon?.code).toBe('DESC10');
    });

    test('checks run in order: not found, then already applied, then expired', async ({
      request,
    }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      expectError(
        await applyCoupon(request, cart.id, { code: 'NAO-EXISTE' }),
        404,
        'COUPON_NOT_FOUND',
      );
      expectError(
        await applyCoupon(request, cart.id, { code: COUPON_CODES.expired }),
        409,
        'COUPON_ALREADY_APPLIED',
      );
    });

    test('a coupon on an empty cart is 409 INVALID_CART_STATE', async ({ request }) => {
      const cart = await createCart(request);
      expectError(
        await applyCoupon(request, cart.body.id, { code: COUPON_CODES.percentage }),
        409,
        'INVALID_CART_STATE',
      );
    });

    test('a coupon on an unknown cart is 404 CART_NOT_FOUND', async ({ request }) => {
      expectError(
        await applyCoupon(request, 2147483647, { code: COUPON_CODES.percentage }),
        404,
        'CART_NOT_FOUND',
      );
    });
  });

  test.describe('remove coupon (RF-007, RN-012)', () => {
    test('removes the coupon and the discount', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      const res = await removeCoupon(request, cart.id);
      expect(res.status).toBe(200);
      expect(res.body.coupon).toBeNull();
      expect(res.body.discountCents).toBe(0);
      expect(res.body.totalCents).toBe(2000);
    });

    test('without an applied coupon is 409 COUPON_NOT_APPLIED', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(await removeCoupon(request, cart.id), 409, 'COUPON_NOT_APPLIED');
    });

    test('swapping a coupon is remove then apply', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 5);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      await removeCoupon(request, cart.id);
      const res = await applyCoupon(request, cart.id, { code: COUPON_CODES.fixed });
      expect(res.status).toBe(200);
      expect(res.body.coupon?.code).toBe('FIXO20');
      expect(res.body.discountCents).toBe(2000);
    });
  });

  test('coupon can be applied and removed while in checkout (RF-006, RF-007)', async ({
    request,
  }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 2);
    const applied = await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('in_checkout');
    expect(applied.body.discountCents).toBe(200);
    const removed = await removeCoupon(request, cart.id);
    expect(removed.status).toBe(200);
    expect(removed.body.status).toBe('in_checkout');
    expect(removed.body.coupon).toBeNull();
  });

  test.describe('minimum order after the coupon is applied (RN-016, RN-011)', () => {
    test('the coupon stays and the discount follows the subtotal; confirmation is refused', async ({
      request,
    }) => {
      const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.regular, 5);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.minOrder });

      const reduced = await updateItem(request, cart.id, product.id, { quantity: 1 });
      expect(reduced.status).toBe(200);
      expect(reduced.body.coupon?.code).toBe('MIN200');
      expect(reduced.body.subtotalCents).toBe(4990);
      // floor(4990 * 15 / 100) = 748
      expect(reduced.body.discountCents).toBe(748);
      expect(reduced.body.totalCents).toBe(4242);

      const toCheckout = await checkout(request, cart.id);
      expect(toCheckout.status).toBe(200);
      const refused = await confirm(request, cart.id);
      expectError(refused, 422, 'COUPON_MIN_ORDER_NOT_MET');
      const after = await getCart(request, cart.id);
      expect(after.body.status).toBe('in_checkout');
      expect(after.body.coupon?.code).toBe('MIN200');
    });

    test('going back to editing keeps the coupon (RF-009)', async ({ request }) => {
      const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 2);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      const res = await edit(request, cart.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('with_items');
      expect(res.body.coupon?.code).toBe('DESC10');
      expect(res.body.discountCents).toBe(200);
    });
  });
});
