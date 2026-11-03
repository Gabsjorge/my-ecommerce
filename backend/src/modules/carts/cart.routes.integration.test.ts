import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import type { Database } from '../../db/client';
import { carts, products } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCoupon, createProduct } from '../../test-support/factories';

const START = new Date('2030-01-01T12:00:00Z');
let now = START;
const { app, db, close } = createTestApp({ clock: () => now, cartInactivityTimeoutSeconds: 10 });
const cleanup = createCleanup();
const MISSING = 2147483647;

beforeEach(() => {
  now = START;
});
afterEach(() => cleanup.run(db));
afterAll(() => close());

async function newCart(): Promise<number> {
  const res = await request(app).post('/api/carts');
  cleanup.trackCart(res.body.id);
  return res.body.id;
}

async function cartWithItem(quantity = 2, productOverrides = {}) {
  const product = await createProduct(db, cleanup, {
    priceCents: 1000,
    stock: 10,
    ...productOverrides,
  });
  const cartId = await newCart();
  await request(app).post(`/api/carts/${cartId}/items`).send({ productId: product.id, quantity });
  return { cartId, product };
}

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body.error.code).toBe(code);
  expect(typeof res.body.error.message).toBe('string');
}

describe('POST /api/carts and GET /api/carts/:cartId', () => {
  it('creates an empty cart (201) and reads it back (200)', async () => {
    const created = await request(app).post('/api/carts');
    cleanup.trackCart(created.body.id);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: created.body.id,
      status: 'empty',
      items: [],
      coupon: null,
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });

    const read = await request(app).get(`/api/carts/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
  });

  it('returns 404 CART_NOT_FOUND for an unknown cart', async () => {
    expectError(await request(app).get(`/api/carts/${MISSING}`), 404, 'CART_NOT_FOUND');
  });

  it.each(['0', '-1', 'abc', '1.5', '2147483648'])('returns 400 for cart id %s', async (id) => {
    expectError(await request(app).get(`/api/carts/${id}`), 400, 'VALIDATION_ERROR');
  });

  it('returns the abandoned state on read after the timeout, without renewing activity', async () => {
    const { cartId } = await cartWithItem();
    const [before] = await db.select().from(carts).where(eq(carts.id, cartId));
    now = new Date(START.getTime() + 10_001);

    const res = await request(app).get(`/api/carts/${cartId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('abandoned');
    const [after] = await db.select().from(carts).where(eq(carts.id, cartId));
    expect(after.lastActivityAt).toEqual(before.lastActivityAt);
  });
});

describe('POST /api/carts/:cartId/items', () => {
  it('adds an item (200) and sums a repeated product', async () => {
    const { cartId, product } = await cartWithItem(2);
    const res = await request(app)
      .post(`/api/carts/${cartId}/items`)
      .send({ productId: product.id, quantity: 3 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('with_items');
    expect(res.body.items).toEqual([
      {
        productId: product.id,
        name: product.name,
        quantity: 5,
        unitPriceCents: 1000,
        subtotalCents: 5000,
      },
    ]);
    expect(res.body.totalCents).toBe(5000);
  });

  it.each([
    ['zero quantity', { quantity: 0 }],
    ['decimal quantity', { quantity: 1.5 }],
    ['string quantity', { quantity: '2' }],
    ['missing quantity', {}],
    ['negative quantity', { quantity: -1 }],
    ['quantity above int32', { quantity: 2147483648 }],
  ])('returns 400 for %s and leaves the cart unchanged', async (_label, extra) => {
    const product = await createProduct(db, cleanup);
    const cartId = await newCart();
    const res = await request(app)
      .post(`/api/carts/${cartId}/items`)
      .send({ productId: product.id, ...extra });
    expectError(res, 400, 'VALIDATION_ERROR');
    expect((await request(app).get(`/api/carts/${cartId}`)).body.status).toBe('empty');
  });

  it('returns 400 for a productId above int32 and for malformed or absent bodies', async () => {
    const cartId = await newCart();
    expectError(
      await request(app)
        .post(`/api/carts/${cartId}/items`)
        .send({ productId: 2147483648, quantity: 1 }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await request(app)
        .post(`/api/carts/${cartId}/items`)
        .set('Content-Type', 'application/json')
        .send('{"productId": 1,'),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await request(app).post(`/api/carts/${cartId}/items`), 400, 'VALIDATION_ERROR');
  });

  it('returns 404 for an unknown cart and an unknown product', async () => {
    const product = await createProduct(db, cleanup);
    expectError(
      await request(app)
        .post(`/api/carts/${MISSING}/items`)
        .send({ productId: product.id, quantity: 1 }),
      404,
      'CART_NOT_FOUND',
    );
    const cartId = await newCart();
    expectError(
      await request(app)
        .post(`/api/carts/${cartId}/items`)
        .send({ productId: MISSING, quantity: 1 }),
      404,
      'PRODUCT_NOT_FOUND',
    );
  });

  it('returns 409 INSUFFICIENT_STOCK with details, and for a product with stock 0', async () => {
    const limited = await createProduct(db, cleanup, { stock: 2 });
    const none = await createProduct(db, cleanup, { stock: 0 });
    const cartId = await newCart();

    const over = await request(app)
      .post(`/api/carts/${cartId}/items`)
      .send({ productId: limited.id, quantity: 3 });
    expectError(over, 409, 'INSUFFICIENT_STOCK');
    expect(over.body.error.details.items).toEqual([
      { productId: limited.id, requested: 3, available: 2 },
    ]);
    expectError(
      await request(app)
        .post(`/api/carts/${cartId}/items`)
        .send({ productId: none.id, quantity: 1 }),
      409,
      'INSUFFICIENT_STOCK',
    );
  });

  it('returns 409 INVALID_CART_STATE once the cart is in checkout', async () => {
    const { cartId, product } = await cartWithItem();
    await request(app).post(`/api/carts/${cartId}/checkout`);
    expectError(
      await request(app)
        .post(`/api/carts/${cartId}/items`)
        .send({ productId: product.id, quantity: 1 }),
      409,
      'INVALID_CART_STATE',
    );
  });

  it('records the abandonment and refuses the write after the timeout', async () => {
    const { cartId, product } = await cartWithItem();
    now = new Date(START.getTime() + 10_001);

    expectError(
      await request(app)
        .post(`/api/carts/${cartId}/items`)
        .send({ productId: product.id, quantity: 1 }),
      409,
      'INVALID_CART_STATE',
    );
    expect((await request(app).get(`/api/carts/${cartId}`)).body.status).toBe('abandoned');
  });
});

describe('PATCH and DELETE /api/carts/:cartId/items/:productId', () => {
  it('updates the quantity (200)', async () => {
    const { cartId, product } = await cartWithItem(2);
    const res = await request(app)
      .patch(`/api/carts/${cartId}/items/${product.id}`)
      .send({ quantity: 7 });
    expect(res.status).toBe(200);
    expect(res.body.items[0].quantity).toBe(7);
  });

  it('validates the quantity and the ids (400)', async () => {
    const { cartId, product } = await cartWithItem();
    for (const quantity of [0, -1, 1.5, '2']) {
      expectError(
        await request(app).patch(`/api/carts/${cartId}/items/${product.id}`).send({ quantity }),
        400,
        'VALIDATION_ERROR',
      );
    }
    expectError(
      await request(app).patch(`/api/carts/${cartId}/items/abc`).send({ quantity: 1 }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await request(app).delete(`/api/carts/${cartId}/items/0`), 400, 'VALIDATION_ERROR');
  });

  it('returns 404 CART_ITEM_NOT_FOUND and CART_NOT_FOUND', async () => {
    const { cartId } = await cartWithItem();
    expectError(
      await request(app).patch(`/api/carts/${cartId}/items/${MISSING}`).send({ quantity: 1 }),
      404,
      'CART_ITEM_NOT_FOUND',
    );
    expectError(
      await request(app).delete(`/api/carts/${cartId}/items/${MISSING}`),
      404,
      'CART_ITEM_NOT_FOUND',
    );
    expectError(await request(app).delete(`/api/carts/${MISSING}/items/1`), 404, 'CART_NOT_FOUND');
  });

  it('returns 409 INSUFFICIENT_STOCK above the stock', async () => {
    const { cartId, product } = await cartWithItem(1, { stock: 3 });
    expectError(
      await request(app).patch(`/api/carts/${cartId}/items/${product.id}`).send({ quantity: 4 }),
      409,
      'INSUFFICIENT_STOCK',
    );
  });

  it('removes the last item: back to empty without coupon (200)', async () => {
    const { cartId, product } = await cartWithItem();
    const coupon = await createCoupon(db, cleanup);
    await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: coupon.code });

    const res = await request(app).delete(`/api/carts/${cartId}/items/${product.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'empty', items: [], coupon: null, totalCents: 0 });
  });

  it('returns 409 INVALID_CART_STATE for edits during checkout', async () => {
    const { cartId, product } = await cartWithItem();
    await request(app).post(`/api/carts/${cartId}/checkout`);
    expectError(
      await request(app).patch(`/api/carts/${cartId}/items/${product.id}`).send({ quantity: 1 }),
      409,
      'INVALID_CART_STATE',
    );
    expectError(
      await request(app).delete(`/api/carts/${cartId}/items/${product.id}`),
      409,
      'INVALID_CART_STATE',
    );
  });
});

describe('coupon routes', () => {
  it('applies a coupon with a normalized code (200) and removes it (200)', async () => {
    const { cartId } = await cartWithItem(2);
    const coupon = await createCoupon(db, cleanup, { type: 'fixed', value: 500 });

    const applied = await request(app)
      .post(`/api/carts/${cartId}/coupon`)
      .send({ code: `  ${coupon.code.toLowerCase()} ` });
    expect(applied.status).toBe(200);
    expect(applied.body.coupon).toEqual({ code: coupon.code, type: 'fixed', value: 500 });
    expect(applied.body).toMatchObject({
      subtotalCents: 2000,
      discountCents: 500,
      totalCents: 1500,
    });

    const removed = await request(app).delete(`/api/carts/${cartId}/coupon`);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ coupon: null, discountCents: 0, totalCents: 2000 });
  });

  it('returns 400 for an invalid code before looking at the state, even on an empty cart', async () => {
    const cartId = await newCart();
    for (const body of [{ code: 'ab' }, { code: 'bad code!' }, {}, { code: 7 }]) {
      expectError(
        await request(app).post(`/api/carts/${cartId}/coupon`).send(body),
        400,
        'VALIDATION_ERROR',
      );
    }
  });

  it('maps each coupon error to its status', async () => {
    const { cartId } = await cartWithItem(1);
    const expired = await createCoupon(db, cleanup, {
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    const used = await createCoupon(db, cleanup, { usedAt: new Date('2020-01-01T00:00:00Z') });
    const min = await createCoupon(db, cleanup, { minOrderCents: 999999 });
    const ok = await createCoupon(db, cleanup);
    const apply = (code: string) => request(app).post(`/api/carts/${cartId}/coupon`).send({ code });

    expectError(await apply('NAO-EXISTE'), 404, 'COUPON_NOT_FOUND');
    expectError(await apply(expired.code), 422, 'COUPON_EXPIRED');
    expectError(await apply(used.code), 422, 'COUPON_ALREADY_USED');
    expectError(await apply(min.code), 422, 'COUPON_MIN_ORDER_NOT_MET');
    expectError(
      await request(app).delete(`/api/carts/${cartId}/coupon`),
      409,
      'COUPON_NOT_APPLIED',
    );
    expect((await apply(ok.code)).status).toBe(200);
    expectError(await apply(ok.code), 409, 'COUPON_ALREADY_APPLIED');
  });

  it('returns 409 INVALID_CART_STATE for an empty cart and 404 for an unknown one', async () => {
    const cartId = await newCart();
    const coupon = await createCoupon(db, cleanup);
    expectError(
      await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: coupon.code }),
      409,
      'INVALID_CART_STATE',
    );
    expectError(
      await request(app).post(`/api/carts/${MISSING}/coupon`).send({ code: coupon.code }),
      404,
      'CART_NOT_FOUND',
    );
  });
});

describe('transition routes', () => {
  it('walks checkout, edit and abandon (200 each)', async () => {
    const { cartId } = await cartWithItem();
    expect((await request(app).post(`/api/carts/${cartId}/checkout`)).body.status).toBe(
      'in_checkout',
    );
    expect((await request(app).post(`/api/carts/${cartId}/edit`)).body.status).toBe('with_items');
    await request(app).post(`/api/carts/${cartId}/checkout`);
    expect((await request(app).post(`/api/carts/${cartId}/abandon`)).body.status).toBe('abandoned');
  });

  it('ignores a body on routes that take none', async () => {
    const { cartId } = await cartWithItem();
    const res = await request(app).post(`/api/carts/${cartId}/checkout`).send({ anything: true });
    expect(res.status).toBe(200);
  });

  it('returns 409 for forbidden operations, including abandoning an empty cart', async () => {
    const cartId = await newCart();
    expectError(await request(app).post(`/api/carts/${cartId}/abandon`), 409, 'INVALID_CART_STATE');
    expectError(
      await request(app).post(`/api/carts/${cartId}/checkout`),
      409,
      'INVALID_CART_STATE',
    );
    expectError(await request(app).post(`/api/carts/${cartId}/edit`), 409, 'INVALID_CART_STATE');
    expectError(await request(app).post(`/api/carts/${cartId}/confirm`), 409, 'INVALID_CART_STATE');
    expectError(await request(app).post(`/api/carts/${MISSING}/checkout`), 404, 'CART_NOT_FOUND');
  });
});

describe('POST /api/carts/:cartId/confirm', () => {
  it('returns 201 with the order and the cart, and decrements the stock', async () => {
    const { cartId, product } = await cartWithItem(2, { stock: 5 });
    const coupon = await createCoupon(db, cleanup, { value: 10 });
    await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: coupon.code });
    await request(app).post(`/api/carts/${cartId}/checkout`);

    const res = await request(app).post(`/api/carts/${cartId}/confirm`);

    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      cartId,
      status: 'created',
      items: [{ productId: product.id, name: product.name, quantity: 2, unitPriceCents: 1000 }],
      subtotalCents: 2000,
      discountCents: 200,
      totalCents: 1800,
      couponCode: coupon.code,
    });
    expect(typeof res.body.order.id).toBe('number');
    expect(typeof res.body.order.createdAt).toBe('string');
    expect(res.body.cart.status).toBe('order_created');
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(3);
    expectError(await request(app).post(`/api/carts/${cartId}/confirm`), 409, 'INVALID_CART_STATE');
  });

  it('returns 409 INSUFFICIENT_STOCK with details and keeps the cart in checkout', async () => {
    const { cartId, product } = await cartWithItem(3, { stock: 5 });
    await request(app).post(`/api/carts/${cartId}/checkout`);
    await db.update(products).set({ stock: 1 }).where(eq(products.id, product.id));

    const res = await request(app).post(`/api/carts/${cartId}/confirm`);

    expectError(res, 409, 'INSUFFICIENT_STOCK');
    expect(res.body.error.details.items).toEqual([
      { productId: product.id, requested: 3, available: 1 },
    ]);
    expect((await request(app).get(`/api/carts/${cartId}`)).body.status).toBe('in_checkout');
  });

  it('returns 422 when the coupon was consumed by another order', async () => {
    const coupon = await createCoupon(db, cleanup);
    const first = await cartWithItem(1);
    const second = await cartWithItem(1);
    for (const { cartId } of [first, second]) {
      await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: coupon.code });
      await request(app).post(`/api/carts/${cartId}/checkout`);
    }

    expect((await request(app).post(`/api/carts/${first.cartId}/confirm`)).status).toBe(201);
    expectError(
      await request(app).post(`/api/carts/${second.cartId}/confirm`),
      422,
      'COUPON_ALREADY_USED',
    );
  });
});

describe('POST /api/carts/:cartId/confirm: coupon and cart failures', () => {
  it('returns 404 CART_NOT_FOUND for an unknown cart', async () => {
    expectError(await request(app).post(`/api/carts/${MISSING}/confirm`), 404, 'CART_NOT_FOUND');
  });

  it('returns 422 COUPON_EXPIRED when the coupon expires between apply and confirm', async () => {
    const { cartId, product } = await cartWithItem(2, { stock: 5 });
    const coupon = await createCoupon(db, cleanup, {
      expiresAt: new Date(START.getTime() + 5_000),
    });
    expect(
      (await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: coupon.code })).status,
    ).toBe(200);
    await request(app).post(`/api/carts/${cartId}/checkout`);
    now = new Date(START.getTime() + 6_000);

    expectError(await request(app).post(`/api/carts/${cartId}/confirm`), 422, 'COUPON_EXPIRED');

    expect((await request(app).get(`/api/carts/${cartId}`)).body.status).toBe('in_checkout');
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(5);
  });

  it('returns 422 COUPON_MIN_ORDER_NOT_MET when the subtotal fell below the minimum (RN-016)', async () => {
    const { cartId, product } = await cartWithItem(6, { stock: 10 });
    const coupon = await createCoupon(db, cleanup, { minOrderCents: 5000 });
    expect(
      (await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: coupon.code })).status,
    ).toBe(200);
    const lowered = await request(app)
      .patch(`/api/carts/${cartId}/items/${product.id}`)
      .send({ quantity: 2 });
    expect(lowered.status).toBe(200);
    expect(lowered.body.coupon.code).toBe(coupon.code);
    await request(app).post(`/api/carts/${cartId}/checkout`);

    expectError(
      await request(app).post(`/api/carts/${cartId}/confirm`),
      422,
      'COUPON_MIN_ORDER_NOT_MET',
    );

    expect((await request(app).get(`/api/carts/${cartId}`)).body.status).toBe('in_checkout');
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(10);
  });
});

describe('unexpected failures', () => {
  it('returns 500 INTERNAL_ERROR without details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const brokenDb = {
      insert: () => {
        throw new Error('secret database detail');
      },
    } as unknown as Database;

    const res = await request(createApp({ db: brokenDb })).post('/api/carts');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    spy.mockRestore();
  });
});

describe('item route input validation (hardening)', () => {
  it.each([
    ['string', '2'],
    ['decimal', 1.5],
    ['zero', 0],
    ['negative', -1],
    ['null', null],
    ['above int32', 2147483648],
  ])(
    'PATCH rejects a %s quantity with 400 and leaves the line untouched',
    async (_name, quantity) => {
      const { cartId, product } = await cartWithItem(2);

      const res = await request(app)
        .patch(`/api/carts/${cartId}/items/${product.id}`)
        .send({ quantity });

      expectError(res, 400, 'VALIDATION_ERROR');
      const cart = await request(app).get(`/api/carts/${cartId}`);
      expect(cart.body.items[0].quantity).toBe(2);
    },
  );

  it.each(['-1', '0', '1.5', 'abc', '2147483648'])(
    'DELETE rejects productId %s in the path with 400',
    async (productId) => {
      const { cartId } = await cartWithItem(1);
      expectError(
        await request(app).delete(`/api/carts/${cartId}/items/${productId}`),
        400,
        'VALIDATION_ERROR',
      );
    },
  );
});

describe('percentage coupon with minimum order over HTTP (RN-015, RN-017)', () => {
  it('applies the seeded MIN200 coupon at the minimum and floors the 15% discount', async () => {
    // 2 x 10001 = 20002 cents: above the 20000 minimum, and 15% = 3000.3 -> 3000.
    const { cartId } = await cartWithItem(2, { priceCents: 10001 });

    const res = await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: ' min200 ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      subtotalCents: 20002,
      discountCents: 3000,
      totalCents: 17002,
      coupon: { code: 'MIN200' },
    });
  });

  it('refuses MIN200 one cent below the minimum', async () => {
    const { cartId } = await cartWithItem(1, { priceCents: 19999 });

    expectError(
      await request(app).post(`/api/carts/${cartId}/coupon`).send({ code: 'MIN200' }),
      422,
      'COUPON_MIN_ORDER_NOT_MET',
    );
  });
});
