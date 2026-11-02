import { expect, test } from '@playwright/test';
import {
  abandon,
  addItem,
  applyCoupon,
  cartWithItem,
  checkout,
  COUPON_CODES,
  createCart,
  edit,
  expectError,
  findProductByName,
  getCart,
  PRODUCT_NAMES,
  removeCoupon,
  removeItem,
  confirm,
  updateItem,
} from '../../support/api';

// None of these tests consumes stock or coupons: they only read and edit carts.
test.describe('carts API', () => {
  test('POST /api/carts creates an empty cart (RF-001)', async ({ request }) => {
    const res = await createCart(request);
    expect(res.status).toBe(201);
    expect(Number.isInteger(res.body.id)).toBe(true);
    expect(res.body).toEqual({
      id: res.body.id,
      status: 'empty',
      items: [],
      coupon: null,
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });

  test('several carts coexist with distinct ids (RF-001)', async ({ request }) => {
    const a = await createCart(request);
    const b = await createCart(request);
    expect(a.body.id).not.toBe(b.body.id);
  });

  test('GET returns the same view that was created (RF-002)', async ({ request }) => {
    const created = await createCart(request);
    const res = await getCart(request, created.body.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  test('GET of an unknown cart is 404 CART_NOT_FOUND', async ({ request }) => {
    expectError(await getCart(request, 2147483647), 404, 'CART_NOT_FOUND');
  });

  for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
    test(`GET with invalid cart id "${id}" is 400 VALIDATION_ERROR`, async ({ request }) => {
      expectError(await getCart(request, id), 400, 'VALIDATION_ERROR');
    });
  }

  test('first item moves the cart to with_items with the current price (RF-003)', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 3);
    expect(cart.status).toBe('with_items');
    expect(cart.items).toEqual([
      {
        productId: product.id,
        name: product.name,
        quantity: 3,
        unitPriceCents: product.priceCents,
        subtotalCents: product.priceCents * 3,
      },
    ]);
    expect(cart.subtotalCents).toBe(product.priceCents * 3);
    expect(cart.discountCents).toBe(0);
    expect(cart.totalCents).toBe(product.priceCents * 3);
  });

  test('adding the same product sums the quantity in a single line (RN-001, RN-003)', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    const res = await addItem(request, cart.id, { productId: product.id, quantity: 5 });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(7);
    expect(res.body.items[0].unitPriceCents).toBe(product.priceCents);
    expect(res.body.subtotalCents).toBe(product.priceCents * 7);
  });

  test('different products create different lines and the subtotal sums them', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    const other = await findProductByName(request, PRODUCT_NAMES.limitedStock);
    const res = await addItem(request, cart.id, { productId: other.id, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.subtotalCents).toBe(product.priceCents + other.priceCents * 2);
  });

  test('unknown product is 404 PRODUCT_NOT_FOUND', async ({ request }) => {
    const cart = await createCart(request);
    const res = await addItem(request, cart.body.id, { productId: 2147483647, quantity: 1 });
    expectError(res, 404, 'PRODUCT_NOT_FOUND');
    expect((await getCart(request, cart.body.id)).body.status).toBe('empty');
  });

  test('item on an unknown cart is 404 CART_NOT_FOUND', async ({ request }) => {
    const product = await findProductByName(request, PRODUCT_NAMES.highStock);
    const res = await addItem(request, 2147483647, { productId: product.id, quantity: 1 });
    expectError(res, 404, 'CART_NOT_FOUND');
  });

  test.describe('stock limits (RN-005)', () => {
    test('quantity equal to the stock is accepted', async ({ request }) => {
      const product = await findProductByName(request, PRODUCT_NAMES.limitedStock);
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.limitedStock, product.stock);
      expect(cart.items[0].quantity).toBe(product.stock);
    });

    test('quantity above the stock is 409 INSUFFICIENT_STOCK and the cart is unchanged', async ({
      request,
    }) => {
      const product = await findProductByName(request, PRODUCT_NAMES.limitedStock);
      const cart = await createCart(request);
      const res = await addItem(request, cart.body.id, {
        productId: product.id,
        quantity: product.stock + 1,
      });
      expectError(res, 409, 'INSUFFICIENT_STOCK');
      expect((await getCart(request, cart.body.id)).body).toEqual(cart.body);
    });

    test('summing past the stock is refused and the line keeps its quantity', async ({
      request,
    }) => {
      const product = await findProductByName(request, PRODUCT_NAMES.limitedStock);
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.limitedStock, product.stock - 1);
      const res = await addItem(request, cart.id, { productId: product.id, quantity: 2 });
      expectError(res, 409, 'INSUFFICIENT_STOCK');
      const after = await getCart(request, cart.id);
      expect(after.body.items[0].quantity).toBe(product.stock - 1);
    });

    test('a product with stock 0 cannot be added', async ({ request }) => {
      const product = await findProductByName(request, PRODUCT_NAMES.outOfStock);
      expect(product.stock).toBe(0);
      const cart = await createCart(request);
      const res = await addItem(request, cart.body.id, { productId: product.id, quantity: 1 });
      expectError(res, 409, 'INSUFFICIENT_STOCK');
      expect((await getCart(request, cart.body.id)).body.status).toBe('empty');
    });
  });

  test.describe('update quantity (RF-004)', () => {
    test('replaces the quantity of the line', async ({ request }) => {
      const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 5);
      const res = await updateItem(request, cart.id, product.id, { quantity: 2 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('with_items');
      expect(res.body.items[0].quantity).toBe(2);
      expect(res.body.subtotalCents).toBe(product.priceCents * 2);
    });

    test('an item that is not in the cart is 404 CART_ITEM_NOT_FOUND', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      const other = await findProductByName(request, PRODUCT_NAMES.limitedStock);
      expectError(
        await updateItem(request, cart.id, other.id, { quantity: 1 }),
        404,
        'CART_ITEM_NOT_FOUND',
      );
    });

    test('quantity above the stock is 409 INSUFFICIENT_STOCK and keeps the line', async ({
      request,
    }) => {
      const product = await findProductByName(request, PRODUCT_NAMES.limitedStock);
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.limitedStock, 1);
      const res = await updateItem(request, cart.id, product.id, { quantity: product.stock + 1 });
      expectError(res, 409, 'INSUFFICIENT_STOCK');
      expect((await getCart(request, cart.id)).body.items[0].quantity).toBe(1);
    });
  });

  test.describe('remove item (RF-005, RN-016)', () => {
    test('removing one of several lines keeps with_items', async ({ request }) => {
      const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      const other = await findProductByName(request, PRODUCT_NAMES.limitedStock);
      await addItem(request, cart.id, { productId: other.id, quantity: 1 });
      const res = await removeItem(request, cart.id, product.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('with_items');
      expect(res.body.items.map((i) => i.productId)).toEqual([other.id]);
    });

    test('removing the last item returns to empty and drops the coupon', async ({ request }) => {
      const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
      const applied = await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
      expect(applied.body.coupon?.code).toBe(COUPON_CODES.percentage);
      const res = await removeItem(request, cart.id, product.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: cart.id,
        status: 'empty',
        items: [],
        coupon: null,
        subtotalCents: 0,
        discountCents: 0,
        totalCents: 0,
      });
    });

    test('an item that is not in the cart is 404 CART_ITEM_NOT_FOUND', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      const other = await findProductByName(request, PRODUCT_NAMES.limitedStock);
      expectError(await removeItem(request, cart.id, other.id), 404, 'CART_ITEM_NOT_FOUND');
    });
  });

  test.describe('input validation: 400 VALIDATION_ERROR and the cart stays unchanged', () => {
    const invalidQuantities: [string, unknown][] = [
      ['zero', 0],
      ['negative', -1],
      ['decimal', 1.5],
      ['numeric text', '2'],
      ['non numeric text', 'abc'],
      ['null', null],
    ];

    for (const [label, quantity] of invalidQuantities) {
      test(`add item with ${label} quantity`, async ({ request }) => {
        const product = await findProductByName(request, PRODUCT_NAMES.highStock);
        const cart = await createCart(request);
        const res = await addItem(request, cart.body.id, { productId: product.id, quantity });
        expectError(res, 400, 'VALIDATION_ERROR');
        expect((await getCart(request, cart.body.id)).body).toEqual(cart.body);
      });

      test(`update item with ${label} quantity`, async ({ request }) => {
        const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
        const res = await updateItem(request, cart.id, product.id, { quantity });
        expectError(res, 400, 'VALIDATION_ERROR');
        expect((await getCart(request, cart.id)).body).toEqual(cart);
      });
    }

    test('missing quantity', async ({ request }) => {
      const product = await findProductByName(request, PRODUCT_NAMES.highStock);
      const cart = await createCart(request);
      expectError(
        await addItem(request, cart.body.id, { productId: product.id }),
        400,
        'VALIDATION_ERROR',
      );
    });

    for (const productId of [0, -1, 1.5, 'abc', 2147483648, null]) {
      test(`add item with invalid productId ${JSON.stringify(productId)}`, async ({ request }) => {
        const cart = await createCart(request);
        expectError(
          await addItem(request, cart.body.id, { productId, quantity: 1 }),
          400,
          'VALIDATION_ERROR',
        );
      });
    }

    test('missing productId', async ({ request }) => {
      const cart = await createCart(request);
      expectError(await addItem(request, cart.body.id, { quantity: 1 }), 400, 'VALIDATION_ERROR');
    });

    test('invalid productId in the path of update and remove', async ({ request }) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      expectError(
        await updateItem(request, cart.id, 'abc', { quantity: 1 }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(await removeItem(request, cart.id, 0), 400, 'VALIDATION_ERROR');
    });

    test('missing body on a route that needs one', async ({ request }) => {
      const cart = await createCart(request);
      const res = await request.post(`/api/carts/${cart.body.id}/items`);
      expect(res.status()).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    });

    test('malformed JSON is 400, not 500', async ({ request }) => {
      const cart = await createCart(request);
      const res = await request.post(`/api/carts/${cart.body.id}/items`, {
        headers: { 'content-type': 'application/json' },
        data: '{"productId": ',
      });
      expect(res.status()).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    });
  });

  test('operations not allowed on an empty cart are 409 INVALID_CART_STATE (RN-018, RN-019)', async ({
    request,
  }) => {
    const cart = await createCart(request);
    const id = cart.body.id;
    const product = await findProductByName(request, PRODUCT_NAMES.highStock);
    const attempts = [
      await updateItem(request, id, product.id, { quantity: 1 }),
      await removeItem(request, id, product.id),
      await applyCoupon(request, id, { code: COUPON_CODES.percentage }),
      await removeCoupon(request, id),
      await checkout(request, id),
      await edit(request, id),
      await abandon(request, id),
      await confirm(request, id),
    ];
    for (const res of attempts) expectError(res, 409, 'INVALID_CART_STATE');
    expect((await getCart(request, id)).body).toEqual(cart.body);
  });

  test('an abandoned cart rejects every write (RN-018)', async ({ request }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    const abandoned = await abandon(request, cart.id);
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.status).toBe('abandoned');
    const attempts = [
      await addItem(request, cart.id, { productId: product.id, quantity: 1 }),
      await updateItem(request, cart.id, product.id, { quantity: 2 }),
      await removeItem(request, cart.id, product.id),
      await checkout(request, cart.id),
      await abandon(request, cart.id),
    ];
    for (const res of attempts) expectError(res, 409, 'INVALID_CART_STATE');
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });
});
