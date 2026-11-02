import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { carts, coupons, orders, products } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCart, createCoupon, createProduct } from '../../test-support/factories';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { DrizzleUnitOfWork } from './cart.unit-of-work';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const TIMEOUT_MS = 10_000;
const START = new Date('2030-01-01T12:00:00Z');

let now = START;
const service = new CartService({
  carts: new CartRepository(db),
  unitOfWork: new DrizzleUnitOfWork(db),
  clock: () => now,
  inactivityTimeoutMs: TIMEOUT_MS,
});

afterEach(async () => {
  now = START;
  await cleanup.run(db);
});
afterAll(() => close());

async function readCart(id: number) {
  const [row] = await db.select().from(carts).where(eq(carts.id, id));
  return row;
}

describe('CartService create and view (integration)', () => {
  it('creates an empty cart stamped with the injected clock', async () => {
    const view = await service.createCart();
    cleanup.trackCart(view.id);

    expect(view.status).toBe('empty');
    expect((await readCart(view.id)).lastActivityAt).toEqual(START);
  });

  it('abandons an idle active cart on read and keeps last_activity_at (RN-020)', async () => {
    const cart = await createCart(db, cleanup, { status: 'with_items', lastActivityAt: START });
    now = new Date(START.getTime() + TIMEOUT_MS + 1);

    const view = await service.getCart(cart.id);

    expect(view.status).toBe('abandoned');
    const row = await readCart(cart.id);
    expect(row.status).toBe('abandoned');
    expect(row.lastActivityAt).toEqual(START);
  });

  it('does not abandon a cart idle exactly for the timeout, nor an empty one', async () => {
    const active = await createCart(db, cleanup, { status: 'in_checkout', lastActivityAt: START });
    const empty = await createCart(db, cleanup, { status: 'empty', lastActivityAt: START });
    now = new Date(START.getTime() + TIMEOUT_MS);
    expect((await service.getCart(active.id)).status).toBe('in_checkout');

    now = new Date(START.getTime() + TIMEOUT_MS * 100);
    expect((await service.getCart(empty.id)).status).toBe('empty');
  });

  it('throws CART_NOT_FOUND for an unknown id', async () => {
    await expect(service.getCart(2147483647)).rejects.toMatchObject({ code: 'CART_NOT_FOUND' });
  });
});

describe('CartService items (integration)', () => {
  it('freezes the price when the line is created and keeps it after a price change (RN-004)', async () => {
    const product = await createProduct(db, cleanup, { priceCents: 1000, stock: 10 });
    const cart = await createCart(db, cleanup);

    await service.addItem(cart.id, product.id, 1);
    await db.update(products).set({ priceCents: 5000 }).where(eq(products.id, product.id));
    const view = await service.addItem(cart.id, product.id, 2);

    expect(view.status).toBe('with_items');
    expect(view.items).toEqual([
      {
        productId: product.id,
        name: product.name,
        quantity: 3,
        unitPriceCents: 1000,
        subtotalCents: 3000,
      },
    ]);
  });

  it('refuses a sum above the stock and keeps the line unchanged', async () => {
    const product = await createProduct(db, cleanup, { stock: 3 });
    const cart = await createCart(db, cleanup);
    await service.addItem(cart.id, product.id, 2);

    await expect(service.addItem(cart.id, product.id, 2)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });

    expect((await service.getCart(cart.id)).items[0].quantity).toBe(2);
  });

  it('removes the last item, returning to empty and dropping the coupon (RN-016)', async () => {
    const product = await createProduct(db, cleanup);
    const coupon = await createCoupon(db, cleanup);
    const cart = await createCart(db, cleanup);
    await service.addItem(cart.id, product.id, 1);
    await db.update(carts).set({ couponId: coupon.id }).where(eq(carts.id, cart.id));

    const view = await service.removeItem(cart.id, product.id);

    expect(view.status).toBe('empty');
    expect(view.coupon).toBeNull();
  });

  it('records the abandonment even though the write is refused (RN-020)', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup, { status: 'with_items', lastActivityAt: START });
    now = new Date(START.getTime() + TIMEOUT_MS + 1);

    await expect(service.addItem(cart.id, product.id, 1)).rejects.toMatchObject({
      code: 'INVALID_CART_STATE',
    });

    const row = await readCart(cart.id);
    expect(row.status).toBe('abandoned');
    expect(row.lastActivityAt).toEqual(START);
  });

  it('restarts the inactivity counter on a successful write only', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup, { lastActivityAt: START });
    now = new Date(START.getTime() + 5_000);

    await service.addItem(cart.id, product.id, 1);

    expect((await readCart(cart.id)).lastActivityAt).toEqual(now);
  });
});

describe('CartService coupons (integration)', () => {
  async function cartWithItem(unitStock = 10) {
    const product = await createProduct(db, cleanup, { priceCents: 1000, stock: unitStock });
    const cart = await createCart(db, cleanup);
    await service.addItem(cart.id, product.id, 2);
    return { product, cart };
  }

  it('applies a percentage coupon and reflects the discount (RF-006, RN-015)', async () => {
    const { cart } = await cartWithItem();
    const coupon = await createCoupon(db, cleanup, { type: 'percentage', value: 10 });

    const view = await service.applyCoupon(cart.id, coupon.code);

    expect(view.coupon).toEqual({ code: coupon.code, type: 'percentage', value: 10 });
    expect(view).toMatchObject({ subtotalCents: 2000, discountCents: 200, totalCents: 1800 });
  });

  it('refuses a second coupon and removal without a coupon', async () => {
    const { cart } = await cartWithItem();
    const first = await createCoupon(db, cleanup);
    const second = await createCoupon(db, cleanup);
    await expect(service.removeCoupon(cart.id)).rejects.toMatchObject({
      code: 'COUPON_NOT_APPLIED',
    });

    await service.applyCoupon(cart.id, first.code);
    await expect(service.applyCoupon(cart.id, second.code)).rejects.toMatchObject({
      code: 'COUPON_ALREADY_APPLIED',
    });
    expect((await service.removeCoupon(cart.id)).coupon).toBeNull();
  });

  it('applying does not consume the coupon: two carts may hold the same one (RN-013)', async () => {
    const a = await cartWithItem();
    const b = await cartWithItem();
    const coupon = await createCoupon(db, cleanup);

    await service.applyCoupon(a.cart.id, coupon.code);
    await expect(service.applyCoupon(b.cart.id, coupon.code)).resolves.toMatchObject({
      coupon: { code: coupon.code },
    });
  });

  it('refuses an empty cart, an expired coupon and a coupon below the minimum', async () => {
    const empty = await createCart(db, cleanup);
    const live = await createCoupon(db, cleanup);
    await expect(service.applyCoupon(empty.id, live.code)).rejects.toMatchObject({
      code: 'INVALID_CART_STATE',
    });

    const { cart } = await cartWithItem();
    const expired = await createCoupon(db, cleanup, {
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    const min = await createCoupon(db, cleanup, { minOrderCents: 5000 });
    await expect(service.applyCoupon(cart.id, expired.code)).rejects.toMatchObject({
      code: 'COUPON_EXPIRED',
    });
    await expect(service.applyCoupon(cart.id, min.code)).rejects.toMatchObject({
      code: 'COUPON_MIN_ORDER_NOT_MET',
    });
  });

  it('keeps the coupon and a recalculated discount after the subtotal drops under the minimum', async () => {
    const { cart, product } = await cartWithItem();
    const coupon = await createCoupon(db, cleanup, { minOrderCents: 2000, value: 50 });
    await service.applyCoupon(cart.id, coupon.code);

    const view = await service.updateItemQuantity(cart.id, product.id, 1);

    expect(view.coupon?.code).toBe(coupon.code);
    expect(view).toMatchObject({ subtotalCents: 1000, discountCents: 500, totalCents: 500 });
  });
});

describe('CartService transitions (integration)', () => {
  it('runs checkout, edit and abandon, keeping the coupon and the stock', async () => {
    const product = await createProduct(db, cleanup, { stock: 5 });
    const coupon = await createCoupon(db, cleanup);
    const cart = await createCart(db, cleanup);
    await service.addItem(cart.id, product.id, 2);
    await service.applyCoupon(cart.id, coupon.code);

    expect((await service.checkout(cart.id)).status).toBe('in_checkout');
    const edited = await service.edit(cart.id);
    expect(edited.status).toBe('with_items');
    expect(edited.coupon?.code).toBe(coupon.code);

    await service.checkout(cart.id);
    const abandoned = await service.abandon(cart.id);
    expect(abandoned.status).toBe('abandoned');

    const [stock] = await db.select().from(products).where(eq(products.id, product.id));
    expect(stock.stock).toBe(5);
    await expect(service.checkout(cart.id)).rejects.toMatchObject({ code: 'INVALID_CART_STATE' });
  });
});

describe('CartService.confirm (integration)', () => {
  async function checkoutCart(productId: number, quantity: number, couponCode?: string) {
    const cart = await createCart(db, cleanup);
    await service.addItem(cart.id, productId, quantity);
    if (couponCode) await service.applyCoupon(cart.id, couponCode);
    await service.checkout(cart.id);
    return cart;
  }

  async function stockOf(productId: number) {
    const [row] = await db.select().from(products).where(eq(products.id, productId));
    return row.stock;
  }

  async function couponUsed(couponId: number) {
    const [row] = await db.select().from(coupons).where(eq(coupons.id, couponId));
    return row.usedAt !== null;
  }

  it('creates the order, decrements stock and consumes the coupon', async () => {
    const product = await createProduct(db, cleanup, { priceCents: 1000, stock: 5 });
    const coupon = await createCoupon(db, cleanup, { value: 10 });
    const cart = await checkoutCart(product.id, 2, coupon.code);

    const { order, cart: view } = await service.confirm(cart.id);

    expect(order).toMatchObject({
      status: 'created',
      subtotalCents: 2000,
      discountCents: 200,
      totalCents: 1800,
      couponCode: coupon.code,
    });
    expect(view.status).toBe('order_created');
    expect(await stockOf(product.id)).toBe(3);
    expect(await couponUsed(coupon.id)).toBe(true);
    await expect(service.confirm(cart.id)).rejects.toMatchObject({ code: 'INVALID_CART_STATE' });
  });

  it('rolls everything back when a failure is injected after the writes (RN-021)', async () => {
    const product = await createProduct(db, cleanup, { stock: 5 });
    const coupon = await createCoupon(db, cleanup);
    const cart = await checkoutCart(product.id, 2, coupon.code);
    const real = new DrizzleUnitOfWork(db);
    const failing = new CartService({
      carts: new CartRepository(db),
      clock: () => now,
      inactivityTimeoutMs: TIMEOUT_MS,
      unitOfWork: {
        run: (work) =>
          real.run((repos) =>
            work({
              ...repos,
              // Keeps the prototype so the repository still works, but fails after the decrement.
              coupons: Object.assign(Object.create(repos.coupons), {
                markUsed: () => Promise.reject(new Error('injected failure')),
              }),
            }),
          ),
      },
    });

    await expect(failing.confirm(cart.id)).rejects.toThrow('injected failure');

    expect(await stockOf(product.id)).toBe(5);
    expect(await couponUsed(coupon.id)).toBe(false);
    expect(await db.select().from(orders).where(eq(orders.cartId, cart.id))).toHaveLength(0);
    expect((await service.getCart(cart.id)).status).toBe('in_checkout');
  });

  it('lets only one of two concurrent confirmations take the last item (RN-008)', async () => {
    const product = await createProduct(db, cleanup, { stock: 1 });
    const a = await checkoutCart(product.id, 1);
    const b = await checkoutCart(product.id, 1);

    const results = await Promise.allSettled([service.confirm(a.id), service.confirm(b.id)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await stockOf(product.id)).toBe(0);
  });

  it('gives a shared coupon to the first confirmation only (RN-013)', async () => {
    const product = await createProduct(db, cleanup, { stock: 10 });
    const coupon = await createCoupon(db, cleanup);
    const a = await checkoutCart(product.id, 1, coupon.code);
    const b = await checkoutCart(product.id, 1, coupon.code);

    await service.confirm(a.id);
    await expect(service.confirm(b.id)).rejects.toMatchObject({ code: 'COUPON_ALREADY_USED' });

    expect((await service.getCart(b.id)).status).toBe('in_checkout');
    expect(await stockOf(product.id)).toBe(9);
  });

  it('fails when the coupon expires between applying and confirming', async () => {
    const product = await createProduct(db, cleanup, { stock: 10 });
    const coupon = await createCoupon(db, cleanup, { expiresAt: new Date(START.getTime() + 1000) });
    const cart = await checkoutCart(product.id, 1, coupon.code);
    now = new Date(START.getTime() + 2000);

    await expect(service.confirm(cart.id)).rejects.toMatchObject({ code: 'COUPON_EXPIRED' });
    expect((await service.getCart(cart.id)).status).toBe('in_checkout');
  });

  it('reports the shortage when the stock dropped after adding to the cart', async () => {
    const product = await createProduct(db, cleanup, { stock: 5 });
    const cart = await checkoutCart(product.id, 3);
    await db.update(products).set({ stock: 1 }).where(eq(products.id, product.id));

    await expect(service.confirm(cart.id)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { items: [{ productId: product.id, requested: 3, available: 1 }] },
    });
    expect((await service.getCart(cart.id)).status).toBe('in_checkout');
    expect(await stockOf(product.id)).toBe(1);
  });
});
