import { expect, test } from '@playwright/test';
import {
  abandon,
  addItem,
  applyCoupon,
  cartInCheckout,
  cartWithItem,
  checkout,
  confirm,
  COUPON_CODES,
  edit,
  expectError,
  findProductByName,
  getCart,
  getStock,
  PRODUCT_NAMES,
  removeCoupon,
  removeItem,
  updateItem,
} from '../../support/api';

// Tests here consume dedicated resources: each consumable coupon is confirmed by exactly one test,
// and the "last item" product by exactly one test. The high-stock product is measured by difference.
test.describe('checkout API', () => {
  test('full flow creates the order, decrements stock and consumes the coupon (RF-008..011)', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    const applied = await applyCoupon(request, cart.id, { code: COUPON_CODES.consumable });
    expect(applied.status).toBe(200);
    const stockBefore = await getStock(request, PRODUCT_NAMES.highStock);

    const inCheckout = await checkout(request, cart.id);
    expect(inCheckout.status).toBe(200);
    expect(inCheckout.body.status).toBe('in_checkout');
    // Starting checkout neither checks nor reserves stock (RN-007).
    expect(await getStock(request, PRODUCT_NAMES.highStock)).toBe(stockBefore);

    const res = await confirm(request, cart.id);
    expect(res.status).toBe(201);
    const { order, cart: finalCart } = res.body;
    expect(Number.isInteger(order.id)).toBe(true);
    expect(order).toEqual({
      id: order.id,
      cartId: cart.id,
      status: 'created',
      items: [
        {
          productId: product.id,
          name: product.name,
          quantity: 2,
          unitPriceCents: product.priceCents,
        },
      ],
      subtotalCents: 2000,
      discountCents: 200,
      totalCents: 1800,
      couponCode: 'CONFIRMA10',
      createdAt: order.createdAt,
    });
    expect(Number.isNaN(Date.parse(order.createdAt))).toBe(false);
    expect(finalCart.status).toBe('order_created');
    expect(finalCart.totalCents).toBe(1800);

    // Stock drops by exactly the ordered quantity.
    expect(await getStock(request, PRODUCT_NAMES.highStock)).toBe(stockBefore - 2);
    expect((await getCart(request, cart.id)).body.status).toBe('order_created');

    // The consumed coupon cannot be applied to another cart (RN-013).
    const other = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    expectError(
      await applyCoupon(request, other.cart.id, { code: COUPON_CODES.consumable }),
      422,
      'COUPON_ALREADY_USED',
    );
  });

  test('order_created is final: every write is 409 INVALID_CART_STATE (RN-022)', async ({
    request,
  }) => {
    const { cart, product } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    expect((await confirm(request, cart.id)).status).toBe(201);
    const stockAfterOrder = await getStock(request, PRODUCT_NAMES.highStock);

    const attempts = [
      await addItem(request, cart.id, { productId: product.id, quantity: 1 }),
      await updateItem(request, cart.id, product.id, { quantity: 2 }),
      await removeItem(request, cart.id, product.id),
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage }),
      await removeCoupon(request, cart.id),
      await checkout(request, cart.id),
      await edit(request, cart.id),
      await abandon(request, cart.id),
      await confirm(request, cart.id),
    ];
    for (const res of attempts) expectError(res, 409, 'INVALID_CART_STATE');
    expect((await getCart(request, cart.id)).body.status).toBe('order_created');
    // The repeated confirm did not decrement stock again.
    expect(await getStock(request, PRODUCT_NAMES.highStock)).toBe(stockAfterOrder);
  });

  test('a fixed coupon above the total zeroes the order total (ZERA-FIXO)', async ({ request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    await applyCoupon(request, cart.id, { code: COUPON_CODES.consumableFixed });
    const res = await confirm(request, cart.id);
    expect(res.status).toBe(201);
    expect(res.body.order.subtotalCents).toBe(1000);
    expect(res.body.order.discountCents).toBe(1000);
    expect(res.body.order.totalCents).toBe(0);
    expect(res.body.order.couponCode).toBe('ZERA-FIXO');
    expect(res.body.cart.status).toBe('order_created');
  });

  test('an order without coupon has couponCode null and no discount', async ({ request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 3);
    const res = await confirm(request, cart.id);
    expect(res.status).toBe(201);
    expect(res.body.order.couponCode).toBeNull();
    expect(res.body.order.discountCents).toBe(0);
    expect(res.body.order.totalCents).toBe(3000);
  });

  test.describe('in checkout', () => {
    test('items are locked: add, update and remove are 409 INVALID_CART_STATE (RN-018)', async ({
      request,
    }) => {
      const { cart, product } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
      expectError(
        await addItem(request, cart.id, { productId: product.id, quantity: 1 }),
        409,
        'INVALID_CART_STATE',
      );
      expectError(
        await updateItem(request, cart.id, product.id, { quantity: 2 }),
        409,
        'INVALID_CART_STATE',
      );
      expectError(await removeItem(request, cart.id, product.id), 409, 'INVALID_CART_STATE');
      expect((await getCart(request, cart.id)).body).toEqual(cart);
    });

    test('checkout again is 409 INVALID_CART_STATE', async ({ request }) => {
      const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
      expectError(await checkout(request, cart.id), 409, 'INVALID_CART_STATE');
    });

    test('edit goes back to with_items, keeps the coupon and allows editing again (RF-009)', async ({
      request,
    }) => {
      const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      await checkout(request, cart.id);

      const res = await edit(request, cart.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('with_items');
      expect(res.body.coupon?.code).toBe('DESC10');

      const updated = await updateItem(request, cart.id, product.id, { quantity: 4 });
      expect(updated.status).toBe(200);
      expect(updated.body.discountCents).toBe(400);
    });

    test('edit is only allowed in checkout (409 in with_items)', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(await edit(request, cart.id), 409, 'INVALID_CART_STATE');
    });

    test('abandoning neither consumes the coupon nor touches stock (RF-010, RN-007)', async ({
      request,
    }) => {
      const stockBefore = await getStock(request, PRODUCT_NAMES.highStock);
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
      await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      await checkout(request, cart.id);

      const res = await abandon(request, cart.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('abandoned');
      expect(await getStock(request, PRODUCT_NAMES.highStock)).toBe(stockBefore);

      // If the coupon had been consumed, a new cart could no longer apply it.
      const other = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      const reapplied = await applyCoupon(request, other.cart.id, {
        code: COUPON_CODES.percentage,
      });
      expect(reapplied.status).toBe(200);
    });

    test('abandoning from with_items is allowed (RF-010)', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      const res = await abandon(request, cart.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('abandoned');
    });
  });

  test.describe('confirm in the wrong state', () => {
    test('with_items is 409 INVALID_CART_STATE and nothing changes', async ({ request }) => {
      const stockBefore = await getStock(request, PRODUCT_NAMES.highStock);
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(await confirm(request, cart.id), 409, 'INVALID_CART_STATE');
      expect((await getCart(request, cart.id)).body.status).toBe('with_items');
      expect(await getStock(request, PRODUCT_NAMES.highStock)).toBe(stockBefore);
    });

    test('an unknown cart is 404 CART_NOT_FOUND', async ({ request }) => {
      expectError(await confirm(request, 2147483647), 404, 'CART_NOT_FOUND');
    });

    test('an invalid cart id is 400 VALIDATION_ERROR', async ({ request }) => {
      expectError(await confirm(request, 'abc'), 400, 'VALIDATION_ERROR');
    });
  });

  test('two carts with the same coupon: the first confirmation wins (RN-013)', async ({
    request,
  }) => {
    const first = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    const second = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    // Applying does not consume the coupon, so both carts can hold it at the same time.
    expect((await applyCoupon(request, first.cart.id, { code: COUPON_CODES.dispute })).status).toBe(
      200,
    );
    expect(
      (await applyCoupon(request, second.cart.id, { code: COUPON_CODES.dispute })).status,
    ).toBe(200);

    const winner = await confirm(request, first.cart.id);
    expect(winner.status).toBe(201);
    expect(winner.body.order.couponCode).toBe('DISPUTA10');

    const loser = await confirm(request, second.cart.id);
    expectError(loser, 422, 'COUPON_ALREADY_USED');
    expect((await getCart(request, second.cart.id)).body.status).toBe('in_checkout');

    // The customer can drop the coupon and confirm without the discount.
    const removed = await removeCoupon(request, second.cart.id);
    expect(removed.status).toBe(200);
    const retried = await confirm(request, second.cart.id);
    expect(retried.status).toBe(201);
    expect(retried.body.order.discountCents).toBe(0);
    expect(retried.body.order.couponCode).toBeNull();
  });

  test('two simultaneous confirmations for the last item: one wins, the other lacks stock (RN-008, RN-009)', async ({
    request,
  }) => {
    const product = await findProductByName(request, PRODUCT_NAMES.lastItem);
    expect(product.stock).toBe(1);
    const a = await cartInCheckout(request, PRODUCT_NAMES.lastItem, 1);
    const b = await cartInCheckout(request, PRODUCT_NAMES.lastItem, 1);

    const [resA, resB] = await Promise.all([
      confirm(request, a.cart.id),
      confirm(request, b.cart.id),
    ]);

    expect([resA.status, resB.status].sort()).toEqual([201, 409]);
    const [winner, loser] = resA.status === 201 ? [a, b] : [b, a];
    const winnerRes = resA.status === 201 ? resA : resB;
    const loserRes = resA.status === 201 ? resB : resA;

    expect(winnerRes.body.order.items[0].quantity).toBe(1);
    expect(winnerRes.body.cart.status).toBe('order_created');

    expectError(loserRes, 409, 'INSUFFICIENT_STOCK');
    const loserError = (loserRes.body as unknown as { error: { details: { items: unknown[] } } })
      .error;
    expect(loserError.details.items).toEqual([
      { productId: product.id, requested: 1, available: 0 },
    ]);

    expect((await getCart(request, winner.cart.id)).body.status).toBe('order_created');
    expect((await getCart(request, loser.cart.id)).body.status).toBe('in_checkout');
    expect(await getStock(request, PRODUCT_NAMES.lastItem)).toBe(0);

    // The failed cart can still leave the checkout normally.
    expect((await edit(request, loser.cart.id)).body.status).toBe('with_items');
  });
});
