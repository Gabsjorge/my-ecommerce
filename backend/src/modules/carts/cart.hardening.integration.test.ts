import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { cartItems, carts, coupons, orderItems, orders, products } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCart, createCoupon, createProduct } from '../../test-support/factories';
import {
  faultInjectingUnitOfWork,
  INJECTED_FAILURE,
  type FaultPoint,
} from '../../test-support/fault-injection';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { DrizzleUnitOfWork, type UnitOfWork } from './cart.unit-of-work';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const TIMEOUT_MS = 10_000;
const START = new Date('2030-01-01T12:00:00Z');
const PAST_TIMEOUT = new Date(START.getTime() + TIMEOUT_MS + 1);

let now = START;

function buildService(unitOfWork: UnitOfWork = new DrizzleUnitOfWork(db)) {
  return new CartService({
    carts: new CartRepository(db),
    unitOfWork,
    clock: () => now,
    inactivityTimeoutMs: TIMEOUT_MS,
  });
}
const service = buildService();

afterEach(async () => {
  now = START;
  await cleanup.run(db);
});
afterAll(() => close());

async function readCart(id: number) {
  const [row] = await db.select().from(carts).where(eq(carts.id, id));
  return row;
}
async function stockOf(productId: number) {
  const [row] = await db.select().from(products).where(eq(products.id, productId));
  return row.stock;
}
async function couponUsedAt(couponId: number) {
  const [row] = await db.select().from(coupons).where(eq(coupons.id, couponId));
  return row.usedAt;
}
async function checkoutCart(productId: number, quantity: number, couponCode?: string) {
  const cart = await createCart(db, cleanup, { lastActivityAt: START });
  await service.addItem(cart.id, productId, quantity);
  if (couponCode) await service.applyCoupon(cart.id, couponCode);
  await service.checkout(cart.id);
  return cart;
}

describe('confirm atomicity at every write step (RN-021)', () => {
  const faults: FaultPoint[] = [
    { repository: 'orders', method: 'create', when: 'after' },
    { repository: 'products', method: 'decrementStock', when: 'after' },
    { repository: 'coupons', method: 'markUsed', when: 'after' },
    { repository: 'carts', method: 'setStatus', when: 'after' },
  ];

  it.each(faults)(
    'rolls back everything when $repository.$method fails $when its write',
    async (fault) => {
      const product = await createProduct(db, cleanup, { priceCents: 8990, stock: 5 });
      const coupon = await createCoupon(db, cleanup);
      const cart = await checkoutCart(product.id, 2, coupon.code);
      const failing = buildService(faultInjectingUnitOfWork(db, fault));

      await expect(failing.confirm(cart.id)).rejects.toThrow(INJECTED_FAILURE);

      expect(await stockOf(product.id)).toBe(5);
      expect(await couponUsedAt(coupon.id)).toBeNull();
      expect(await db.select().from(orders).where(eq(orders.cartId, cart.id))).toHaveLength(0);
      expect((await readCart(cart.id)).status).toBe('in_checkout');
      expect((await service.getCart(cart.id)).coupon?.code).toBe(coupon.code);
    },
  );
});

describe('same-cart concurrency (RN-008, RN-020)', () => {
  it('serializes two concurrent adds on one cart without losing an update', async () => {
    const product = await createProduct(db, cleanup, { stock: 10 });
    const cart = await createCart(db, cleanup, { lastActivityAt: START });

    await Promise.all([
      service.addItem(cart.id, product.id, 1),
      service.addItem(cart.id, product.id, 1),
    ]);

    const view = await service.getCart(cart.id);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(2);
  });

  it('does not let concurrent adds exceed the stock', async () => {
    const product = await createProduct(db, cleanup, { stock: 2 });
    const cart = await createCart(db, cleanup, { lastActivityAt: START });

    const results = await Promise.allSettled([
      service.addItem(cart.id, product.id, 2),
      service.addItem(cart.id, product.id, 2),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect((await service.getCart(cart.id)).items[0].quantity).toBe(2);
  });

  it('refuses a write racing a read that detects the timeout, and records the abandonment', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup, { status: 'with_items', lastActivityAt: START });
    now = PAST_TIMEOUT;

    const [write, read] = await Promise.allSettled([
      service.addItem(cart.id, product.id, 1),
      service.getCart(cart.id),
    ]);

    expect(write).toMatchObject({ status: 'rejected', reason: { code: 'INVALID_CART_STATE' } });
    expect(read).toMatchObject({ status: 'fulfilled', value: { status: 'abandoned' } });
    expect((await readCart(cart.id)).status).toBe('abandoned');
  });

  it('lets two carts sharing a coupon race for it: exactly one order, one COUPON_ALREADY_USED', async () => {
    const product = await createProduct(db, cleanup, { stock: 10 });
    const coupon = await createCoupon(db, cleanup);
    const a = await checkoutCart(product.id, 1, coupon.code);
    const b = await checkoutCart(product.id, 1, coupon.code);

    const results = await Promise.allSettled([service.confirm(a.id), service.confirm(b.id)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'COUPON_ALREADY_USED' });
    expect(await stockOf(product.id)).toBe(9);
    expect(await couponUsedAt(coupon.id)).not.toBeNull();
  });
});

describe('timeout on every write operation (RN-020)', () => {
  const operations: Array<{
    name: string;
    status: 'with_items' | 'in_checkout';
    run: (s: CartService, cartId: number, productId: number) => Promise<unknown>;
  }> = [
    { name: 'addItem', status: 'with_items', run: (s, c, p) => s.addItem(c, p, 1) },
    {
      name: 'updateItemQuantity',
      status: 'with_items',
      run: (s, c, p) => s.updateItemQuantity(c, p, 2),
    },
    { name: 'removeItem', status: 'with_items', run: (s, c, p) => s.removeItem(c, p) },
    { name: 'checkout', status: 'with_items', run: (s, c) => s.checkout(c) },
    { name: 'applyCoupon', status: 'in_checkout', run: (s, c) => s.applyCoupon(c, 'DESC10') },
    { name: 'removeCoupon', status: 'in_checkout', run: (s, c) => s.removeCoupon(c) },
    { name: 'edit', status: 'in_checkout', run: (s, c) => s.edit(c) },
    { name: 'confirm', status: 'in_checkout', run: (s, c) => s.confirm(c) },
    { name: 'abandon', status: 'in_checkout', run: (s, c) => s.abandon(c) },
  ];

  it.each(operations)(
    '$name on an idle cart is refused and the abandonment is committed',
    async (op) => {
      const product = await createProduct(db, cleanup, { stock: 5 });
      const cart = await createCart(db, cleanup, { status: op.status, lastActivityAt: START });
      await db.insert(cartItems).values({
        cartId: cart.id,
        productId: product.id,
        quantity: 1,
        unitPriceCents: product.priceCents,
      });
      now = PAST_TIMEOUT;

      await expect(op.run(service, cart.id, product.id)).rejects.toMatchObject({
        code: 'INVALID_CART_STATE',
      });

      const row = await readCart(cart.id);
      expect(row.status).toBe('abandoned');
      expect(row.lastActivityAt).toEqual(START);
      expect(await stockOf(product.id)).toBe(5);
    },
  );

  it('does not renew the counter when a write is refused for insufficient stock', async () => {
    const product = await createProduct(db, cleanup, { stock: 1 });
    const cart = await createCart(db, cleanup, { lastActivityAt: START });
    now = new Date(START.getTime() + 5_000);

    await expect(service.addItem(cart.id, product.id, 2)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });

    expect((await readCart(cart.id)).lastActivityAt).toEqual(START);
  });
});

describe('frozen price reaches the order (RN-004)', () => {
  it('keeps the price captured when the line was created after the product price changes', async () => {
    const product = await createProduct(db, cleanup, { priceCents: 8990, stock: 5 });
    const cart = await checkoutCart(product.id, 2);
    await db.update(products).set({ priceCents: 12990 }).where(eq(products.id, product.id));

    const { order } = await service.confirm(cart.id);

    expect(order.subtotalCents).toBe(17980);
    expect(order.totalCents).toBe(17980);
    const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: product.id, quantity: 2, unitPriceCents: 8990 });
  });
});

describe('floor rounding persisted in the order (RN-015)', () => {
  it('stores a floored fractional discount with total = subtotal - discount', async () => {
    const product = await createProduct(db, cleanup, { priceCents: 99, stock: 5 });
    const coupon = await createCoupon(db, cleanup, { type: 'percentage', value: 15 });
    const cart = await checkoutCart(product.id, 1, coupon.code);

    const { order } = await service.confirm(cart.id);

    expect(order).toMatchObject({ subtotalCents: 99, discountCents: 14, totalCents: 85 });
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ subtotalCents: 99, discountCents: 14, totalCents: 85 });
  });
});

describe('final states and coupon precedence (RN-010, RN-018, RN-022)', () => {
  async function finalCart(kind: 'order_created' | 'abandoned') {
    const product = await createProduct(db, cleanup, { stock: 5 });
    const cart = await checkoutCart(product.id, 1);
    if (kind === 'order_created') await service.confirm(cart.id);
    else await service.abandon(cart.id);
    return { cart, product };
  }

  it.each(['order_created', 'abandoned'] as const)(
    'rejects every write on a %s cart',
    async (kind) => {
      const { cart, product } = await finalCart(kind);
      const writes = [
        () => service.addItem(cart.id, product.id, 1),
        () => service.updateItemQuantity(cart.id, product.id, 2),
        () => service.removeItem(cart.id, product.id),
        () => service.applyCoupon(cart.id, 'DESC10'),
        () => service.removeCoupon(cart.id),
        () => service.checkout(cart.id),
        () => service.edit(cart.id),
        () => service.abandon(cart.id),
        () => service.confirm(cart.id),
      ];

      for (const write of writes) {
        await expect(write()).rejects.toMatchObject({ code: 'INVALID_CART_STATE' });
      }
      expect((await service.getCart(cart.id)).status).toBe(kind);
    },
  );

  it('applies and removes a coupon while in checkout, keeping the state', async () => {
    const product = await createProduct(db, cleanup, { priceCents: 5000 });
    const coupon = await createCoupon(db, cleanup, { type: 'fixed', value: 1000 });
    const cart = await checkoutCart(product.id, 1);

    const applied = await service.applyCoupon(cart.id, coupon.code);
    expect(applied).toMatchObject({ status: 'in_checkout', discountCents: 1000, totalCents: 4000 });

    const removed = await service.removeCoupon(cart.id);
    expect(removed).toMatchObject({ status: 'in_checkout', discountCents: 0, totalCents: 5000 });
  });

  it('reports COUPON_EXPIRED before COUPON_ALREADY_USED when a coupon is both', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup, { lastActivityAt: START });
    await service.addItem(cart.id, product.id, 1);
    const coupon = await createCoupon(db, cleanup, {
      expiresAt: new Date('2020-01-01T00:00:00Z'),
      usedAt: new Date('2025-01-01T00:00:00Z'),
    });

    await expect(service.applyCoupon(cart.id, coupon.code)).rejects.toMatchObject({
      code: 'COUPON_EXPIRED',
    });
  });

  it('reports COUPON_ALREADY_APPLIED before COUPON_EXPIRED for a second coupon', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup, { lastActivityAt: START });
    await service.addItem(cart.id, product.id, 1);
    const first = await createCoupon(db, cleanup);
    const expired = await createCoupon(db, cleanup, {
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    await service.applyCoupon(cart.id, first.code);

    await expect(service.applyCoupon(cart.id, expired.code)).rejects.toMatchObject({
      code: 'COUPON_ALREADY_APPLIED',
    });
  });
});
