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
  createCart,
  edit,
  expectError,
  findProductByName,
  getCart,
  getStock,
  PRODUCT_NAMES,
  removeCoupon,
  removeItem,
  updateItem,
  type ApiErrorBody,
} from '../../support/api';

// Customer journeys through the whole cart state machine, each one a single sequential test with
// assertions at every step. Persistence is checked black-box: by reading the cart and the product list again.
//
// Isolation: every test builds its own carts. Products "Kit Fluxo ..." are used by this file only, so their
// stock is asserted exactly (tests of one file run serially). Each consumable coupon is confirmed by at
// most one test. Every step of a flow stays well inside the 10 s inactivity timeout, except flow 7 on purpose.

const ALFA_PRICE = 5000;
const BETA_PRICE = 15000;
const TIMEOUT_MS = 10_000;
const PAST_TIMEOUT_MS = TIMEOUT_MS + 1_500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('cart-to-order flows (API)', () => {
  test('flow 1: purchase with a percentage coupon, from the first item to the order', async ({
    request,
  }) => {
    const alfa = await findProductByName(request, PRODUCT_NAMES.flowAlfa);
    const beta = await findProductByName(request, PRODUCT_NAMES.flowBeta);

    const created = await createCart(request);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('empty');
    const cartId = created.body.id;

    // empty -> with_items; adding the same product again sums into the single line (RN-001, RN-003)
    expect((await addItem(request, cartId, { productId: alfa.id, quantity: 2 })).body.status).toBe(
      'with_items',
    );
    await addItem(request, cartId, { productId: beta.id, quantity: 1 });
    const summed = await addItem(request, cartId, { productId: alfa.id, quantity: 1 });
    expect(summed.body.items).toHaveLength(2);
    expect(summed.body.items.find((i) => i.productId === alfa.id)?.quantity).toBe(3);

    const updated = await updateItem(request, cartId, alfa.id, { quantity: 4 });
    expect(updated.body.subtotalCents).toBe(4 * ALFA_PRICE + BETA_PRICE);

    // Removing one line keeps the cart in with_items
    const removed = await removeItem(request, cartId, beta.id);
    expect(removed.body.status).toBe('with_items');
    expect(removed.body.subtotalCents).toBe(4 * ALFA_PRICE);

    const withCoupon = await applyCoupon(request, cartId, { code: COUPON_CODES.flowPct });
    expect(withCoupon.status).toBe(200);
    expect(withCoupon.body).toMatchObject({ subtotalCents: 20000, discountCents: 2000 });
    expect(withCoupon.body.totalCents).toBe(18000);

    const stockBefore = await getStock(request, PRODUCT_NAMES.flowAlfa);
    const betaStockBefore = await getStock(request, PRODUCT_NAMES.flowBeta);
    expect((await checkout(request, cartId)).body.status).toBe('in_checkout');
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(stockBefore);

    const res = await confirm(request, cartId);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      cartId,
      status: 'created',
      subtotalCents: 20000,
      discountCents: 2000,
      totalCents: 18000,
      couponCode: 'FLUXO-PCT',
    });
    expect(res.body.order.items).toEqual([
      { productId: alfa.id, name: alfa.name, quantity: 4, unitPriceCents: ALFA_PRICE },
    ]);
    expect(res.body.cart.status).toBe('order_created');

    // Persistence: the cart is final, stock was decremented for the sold product only, the coupon is spent
    const reread = await getCart(request, cartId);
    expect(reread.body).toMatchObject({ status: 'order_created', totalCents: 18000 });
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(stockBefore - 4);
    expect(await getStock(request, PRODUCT_NAMES.flowBeta)).toBe(betaStockBefore);

    const other = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 1);
    expectError(
      await applyCoupon(request, other.cart.id, { code: COUPON_CODES.flowPct }),
      422,
      'COUPON_ALREADY_USED',
    );
    // order_created is irreversible (RN-022)
    expectError(
      await addItem(request, cartId, { productId: alfa.id, quantity: 1 }),
      409,
      'INVALID_CART_STATE',
    );
    expectError(await abandon(request, cartId), 409, 'INVALID_CART_STATE');
  });

  test('flow 2: purchase without a coupon has no discount and a total equal to the subtotal', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 3);
    const stockBefore = await getStock(request, PRODUCT_NAMES.flowAlfa);
    expect((await checkout(request, cart.id)).status).toBe(200);

    const res = await confirm(request, cart.id);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      status: 'created',
      subtotalCents: 3 * ALFA_PRICE,
      discountCents: 0,
      totalCents: 3 * ALFA_PRICE,
      couponCode: null,
    });
    expect(res.body.order.items[0]).toMatchObject({
      productId: product.id,
      quantity: 3,
      unitPriceCents: ALFA_PRICE,
    });
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(stockBefore - 3);
  });

  test('flow 3: back and forth between checkout and editing, swapping the coupon', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 4);
    const withDesc = await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
    expect(withDesc.body.discountCents).toBe(2000);

    expect((await checkout(request, cart.id)).body.status).toBe('in_checkout');
    // The coupon is swapped while in checkout (RF-006, RF-007)
    const dropped = await removeCoupon(request, cart.id);
    expect(dropped.body).toMatchObject({ coupon: null, discountCents: 0, totalCents: 20000 });
    const swapped = await applyCoupon(request, cart.id, { code: COUPON_CODES.flowFixed });
    expect(swapped.body).toMatchObject({ discountCents: 2000, totalCents: 18000 });

    // Back to editing keeps the coupon (RF-009); the discount follows the new subtotal
    const editing = await edit(request, cart.id);
    expect(editing.body.status).toBe('with_items');
    expect(editing.body.coupon?.code).toBe('FLUXO-FIXO');
    const smaller = await updateItem(request, cart.id, product.id, { quantity: 2 });
    expect(smaller.body).toMatchObject({ subtotalCents: 10000, discountCents: 2000 });
    expect(smaller.body.totalCents).toBe(8000);

    expect((await checkout(request, cart.id)).body.status).toBe('in_checkout');
    const stockBefore = await getStock(request, PRODUCT_NAMES.flowAlfa);
    const res = await confirm(request, cart.id);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      subtotalCents: 10000,
      discountCents: 2000,
      totalCents: 8000,
      couponCode: 'FLUXO-FIXO',
    });
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(stockBefore - 2);

    // Only the coupon that was on the order is spent; the one removed on the way is still free
    const next = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 1);
    expectError(
      await applyCoupon(request, next.cart.id, { code: COUPON_CODES.flowFixed }),
      422,
      'COUPON_ALREADY_USED',
    );
    expect(
      (await applyCoupon(request, next.cart.id, { code: COUPON_CODES.percentage })).status,
    ).toBe(200);
  });

  test('flow 4: the subtotal falls below the coupon minimum before confirming', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.flowBeta, 2);
    const applied = await applyCoupon(request, cart.id, { code: COUPON_CODES.minOrder });
    expect(applied.body).toMatchObject({ subtotalCents: 30000, discountCents: 4500 });

    expect((await checkout(request, cart.id)).status).toBe(200);
    expect((await edit(request, cart.id)).status).toBe(200);
    // Below the minimum (R$ 200): the coupon stays applied until confirmation (RN-016)
    const smaller = await updateItem(request, cart.id, product.id, { quantity: 1 });
    expect(smaller.body).toMatchObject({ subtotalCents: BETA_PRICE, discountCents: 2250 });
    expect(smaller.body.coupon?.code).toBe('MIN200');
    expect((await checkout(request, cart.id)).status).toBe(200);

    const stockBefore = await getStock(request, PRODUCT_NAMES.flowBeta);
    expectError(await confirm(request, cart.id), 422, 'COUPON_MIN_ORDER_NOT_MET');
    const afterFailure = await getCart(request, cart.id);
    expect(afterFailure.body.status).toBe('in_checkout');
    expect(afterFailure.body.coupon?.code).toBe('MIN200');
    expect(await getStock(request, PRODUCT_NAMES.flowBeta)).toBe(stockBefore);

    // Recovery: drop the coupon and confirm without the discount
    expect((await removeCoupon(request, cart.id)).status).toBe(200);
    const res = await confirm(request, cart.id);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      discountCents: 0,
      totalCents: BETA_PRICE,
      couponCode: null,
    });
    expect(await getStock(request, PRODUCT_NAMES.flowBeta)).toBe(stockBefore - 1);

    // MIN200 was never consumed
    const next = await cartWithItem(request, PRODUCT_NAMES.flowBeta, 2);
    expect((await applyCoupon(request, next.cart.id, { code: COUPON_CODES.minOrder })).status).toBe(
      200,
    );
  });

  test('flow 5: a stock shortage fails the whole confirmation, then the customer recovers', async ({
    request,
  }) => {
    const last = await findProductByName(request, PRODUCT_NAMES.flowLast1);
    expect(last.stock).toBe(1);

    // X buys the last unit first
    const x = await cartInCheckout(request, PRODUCT_NAMES.flowLast1, 1);

    // Y holds the same last unit plus another product, and a coupon
    const y = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 2);
    const alfaId = y.product.id;
    await addItem(request, y.cart.id, { productId: last.id, quantity: 1 });
    expect((await applyCoupon(request, y.cart.id, { code: COUPON_CODES.flowStock })).status).toBe(
      200,
    );
    expect((await checkout(request, y.cart.id)).status).toBe(200);

    const xRes = await confirm(request, x.cart.id);
    expect(xRes.status).toBe(201);
    expect(await getStock(request, PRODUCT_NAMES.flowLast1)).toBe(0);

    const alfaBefore = await getStock(request, PRODUCT_NAMES.flowAlfa);
    const failed = await confirm(request, y.cart.id);
    expectError(failed, 409, 'INSUFFICIENT_STOCK');
    expect((failed.body as unknown as ApiErrorBody).error.details?.items).toEqual([
      { productId: last.id, requested: 1, available: 0 },
    ]);

    // Atomic: nothing changed for Y, including the other product's stock
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(alfaBefore);
    const stuck = await getCart(request, y.cart.id);
    expect(stuck.body.status).toBe('in_checkout');
    expect(stuck.body.coupon?.code).toBe('FLUXO-F5');
    expect(stuck.body.items).toHaveLength(2);

    // Recovery: edit, drop the sold-out line, checkout, confirm
    expect((await edit(request, y.cart.id)).body.status).toBe('with_items');
    const trimmed = await removeItem(request, y.cart.id, last.id);
    expect(trimmed.body.items.map((i) => i.productId)).toEqual([alfaId]);
    expect((await checkout(request, y.cart.id)).status).toBe(200);

    const ok = await confirm(request, y.cart.id);
    expect(ok.status).toBe(201);
    // The coupon was not consumed by the failed attempt, so it is on this order
    expect(ok.body.order).toMatchObject({
      subtotalCents: 2 * ALFA_PRICE,
      discountCents: 1000,
      totalCents: 9000,
      couponCode: 'FLUXO-F5',
    });
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(alfaBefore - 2);
  });

  test('flow 6: explicit abandonment leaves stock and coupon untouched and the cart final', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 1);
    expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.flowAbandon })).status).toBe(
      200,
    );
    expect((await checkout(request, cart.id)).status).toBe(200);
    const stockBefore = await getStock(request, PRODUCT_NAMES.flowAlfa);

    const abandoned = await abandon(request, cart.id);
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.status).toBe('abandoned');
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(stockBefore);
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');

    // abandoned is final: every write is refused (RN-018)
    for (const res of [
      await addItem(request, cart.id, { productId: product.id, quantity: 1 }),
      await edit(request, cart.id),
      await checkout(request, cart.id),
      await confirm(request, cart.id),
      await abandon(request, cart.id),
    ]) {
      expectError(res, 409, 'INVALID_CART_STATE');
    }

    // The coupon was not consumed: another cart still confirms with it
    const other = await cartInCheckout(request, PRODUCT_NAMES.flowAlfa, 1);
    expect(
      (await applyCoupon(request, other.cart.id, { code: COUPON_CODES.flowAbandon })).status,
    ).toBe(200);
    const res = await confirm(request, other.cart.id);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ couponCode: 'FLUXO-F6', discountCents: 500 });
  });

  test('flow 7: inactivity in the middle of checkout abandons the cart and blocks the order', async ({
    request,
  }) => {
    test.setTimeout(40_000);
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.flowAlfa, 1);
    expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage })).status).toBe(
      200,
    );
    const stockBefore = await getStock(request, PRODUCT_NAMES.flowAlfa);

    await sleep(PAST_TIMEOUT_MS);

    const read = await getCart(request, cart.id);
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('abandoned');
    expectError(await confirm(request, cart.id), 409, 'INVALID_CART_STATE');
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');

    // No order was created: stock is intact and the coupon is still free
    expect(await getStock(request, PRODUCT_NAMES.flowAlfa)).toBe(stockBefore);
    const next = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 1);
    expect(
      (await applyCoupon(request, next.cart.id, { code: COUPON_CODES.percentage })).status,
    ).toBe(200);
  });

  test('flow 8: emptying the cart drops the coupon and the cart can still be bought', async ({
    request,
  }) => {
    const { cart, product: alfa } = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 1);
    expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage })).status).toBe(
      200,
    );

    const emptied = await removeItem(request, cart.id, alfa.id);
    expect(emptied.body).toMatchObject({ status: 'empty', items: [], coupon: null, totalCents: 0 });
    expect((await getCart(request, cart.id)).body.coupon).toBeNull();

    // empty carts cannot start checkout
    expectError(await checkout(request, cart.id), 409, 'INVALID_CART_STATE');

    const beta = await findProductByName(request, PRODUCT_NAMES.flowBeta);
    expect((await addItem(request, cart.id, { productId: beta.id, quantity: 1 })).body.status).toBe(
      'with_items',
    );
    expect((await checkout(request, cart.id)).status).toBe(200);
    const stockBefore = await getStock(request, PRODUCT_NAMES.flowBeta);

    const res = await confirm(request, cart.id);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      discountCents: 0,
      totalCents: BETA_PRICE,
      couponCode: null,
    });
    expect(res.body.order.items).toHaveLength(1);
    expect(await getStock(request, PRODUCT_NAMES.flowBeta)).toBe(stockBefore - 1);
  });

  test('flow 9: two customers race for the same coupon and the last unit', async ({ request }) => {
    const last = await findProductByName(request, PRODUCT_NAMES.flowLast2);
    expect(last.stock).toBe(1);
    const a = await cartInCheckout(request, PRODUCT_NAMES.flowLast2, 1);
    const b = await cartInCheckout(request, PRODUCT_NAMES.flowLast2, 1);
    for (const { cart } of [a, b]) {
      expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.flowRace })).status).toBe(
        200,
      );
    }

    const [resA, resB] = await Promise.all([
      confirm(request, a.cart.id),
      confirm(request, b.cart.id),
    ]);

    // Exactly one order is created; the loser fails on stock or on the coupon, depending on who locks first
    const results = [resA, resB];
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const winnerIsA = resA.status === 201;
    const [winnerCart, loserCart] = winnerIsA ? [a.cart, b.cart] : [b.cart, a.cart];
    const loser = winnerIsA ? resB : resA;
    expect([409, 422]).toContain(loser.status);
    expect(['INSUFFICIENT_STOCK', 'COUPON_ALREADY_USED']).toContain(
      (loser.body as unknown as ApiErrorBody).error.code,
    );

    expect((await getCart(request, winnerCart.id)).body.status).toBe('order_created');
    expect((await getCart(request, loserCart.id)).body.status).toBe('in_checkout');
    expect(await getStock(request, PRODUCT_NAMES.flowLast2)).toBe(0);

    // The coupon was spent exactly once
    const next = await cartWithItem(request, PRODUCT_NAMES.flowAlfa, 1);
    expectError(
      await applyCoupon(request, next.cart.id, { code: COUPON_CODES.flowRace }),
      422,
      'COUPON_ALREADY_USED',
    );
  });
});
