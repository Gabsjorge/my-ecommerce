import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { cartItems, carts, coupons, orderItems, orders } from './schema';
import { createCleanup } from '../test-support/cleanup';
import { createCart, createCoupon, createProduct } from '../test-support/factories';
import { createTestApp } from '../test-support/app';

const { db, close } = createTestApp();
const cleanup = createCleanup();

afterEach(() => cleanup.run(db));
afterAll(() => close());

// Drizzle wraps driver errors; the Postgres error (with `constraint`) is in `cause`.
async function constraintOf(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string } }).cause;
    return cause?.constraint;
  }
  return undefined;
}

describe('cart schema constraints (integration)', () => {
  it('rejects two lines for the same product in one cart (RN-001)', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup);
    const line = { cartId: cart.id, productId: product.id, quantity: 1, unitPriceCents: 1000 };
    await db.insert(cartItems).values(line);

    expect(await constraintOf(db.insert(cartItems).values(line))).toBe(
      'cart_items_cart_id_product_id_unique',
    );
  });

  it('rejects quantity 0 (RN-002)', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup);

    expect(
      await constraintOf(
        db
          .insert(cartItems)
          .values({ cartId: cart.id, productId: product.id, quantity: 0, unitPriceCents: 1000 }),
      ),
    ).toBe('cart_items_quantity_min');
  });

  it('rejects an invalid cart status', async () => {
    expect(
      await constraintOf(db.insert(carts).values({ status: 'bogus', lastActivityAt: new Date() })),
    ).toBe('carts_status_valid');
  });

  it('cascades cart deletion to its items', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup);
    await db
      .insert(cartItems)
      .values({ cartId: cart.id, productId: product.id, quantity: 2, unitPriceCents: 500 });

    await db.delete(carts).where(eq(carts.id, cart.id));

    const rows = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
    expect(rows).toHaveLength(0);
  });
});

describe('coupon schema constraints (integration)', () => {
  it('rejects a percentage coupon above 100', async () => {
    expect(await constraintOf(createCoupon(db, cleanup, { type: 'percentage', value: 101 }))).toBe(
      'coupons_value_range',
    );
  });

  it('rejects a percentage coupon of 0 and a fixed coupon of 0', async () => {
    expect(await constraintOf(createCoupon(db, cleanup, { type: 'percentage', value: 0 }))).toBe(
      'coupons_value_range',
    );
    expect(await constraintOf(createCoupon(db, cleanup, { type: 'fixed', value: 0 }))).toBe(
      'coupons_value_range',
    );
  });

  it('rejects an unknown type and a negative minimum', async () => {
    expect(await constraintOf(createCoupon(db, cleanup, { type: 'bogus' }))).toBe(
      'coupons_type_valid',
    );
    expect(await constraintOf(createCoupon(db, cleanup, { minOrderCents: -1 }))).toBe(
      'coupons_min_order_cents_nonneg',
    );
  });

  it('rejects a duplicate code', async () => {
    const coupon = await createCoupon(db, cleanup);
    expect(await constraintOf(createCoupon(db, cleanup, { code: coupon.code }))).toBe(
      'coupons_code_unique',
    );
  });

  it('accepts percentage 100 and a fixed coupon above any subtotal', async () => {
    await createCoupon(db, cleanup, { type: 'percentage', value: 100 });
    await createCoupon(db, cleanup, { type: 'fixed', value: 500000 });
    const rows = await db.select().from(coupons);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('order schema constraints (integration)', () => {
  const order = (cartId: number, overrides: Partial<typeof orders.$inferInsert> = {}) => ({
    cartId,
    subtotalCents: 1000,
    discountCents: 100,
    totalCents: 900,
    ...overrides,
  });

  it('rejects two orders with the same coupon (RN-013)', async () => {
    const coupon = await createCoupon(db, cleanup);
    const first = await createCart(db, cleanup);
    const second = await createCart(db, cleanup);
    await db.insert(orders).values(order(first.id, { couponId: coupon.id }));

    expect(
      await constraintOf(db.insert(orders).values(order(second.id, { couponId: coupon.id }))),
    ).toBe('orders_coupon_id_unique');
  });

  it('allows several orders without a coupon', async () => {
    const first = await createCart(db, cleanup);
    const second = await createCart(db, cleanup);
    await db.insert(orders).values(order(first.id));
    await db.insert(orders).values(order(second.id));
  });

  it('rejects two orders for the same cart', async () => {
    const cart = await createCart(db, cleanup);
    await db.insert(orders).values(order(cart.id));
    expect(await constraintOf(db.insert(orders).values(order(cart.id)))).toBe(
      'orders_cart_id_unique',
    );
  });

  it('rejects total different from subtotal minus discount (RN-015)', async () => {
    const cart = await createCart(db, cleanup);
    expect(await constraintOf(db.insert(orders).values(order(cart.id, { totalCents: 1000 })))).toBe(
      'orders_total_consistent',
    );
  });

  it('rejects a status other than created', async () => {
    const cart = await createCart(db, cleanup);
    expect(
      await constraintOf(db.insert(orders).values(order(cart.id, { status: 'shipped' }))),
    ).toBe('orders_status_valid');
  });
});

describe('order money and order_items constraints (integration)', () => {
  const order = (cartId: number, overrides: Partial<typeof orders.$inferInsert> = {}) => ({
    cartId,
    subtotalCents: 1000,
    discountCents: 100,
    totalCents: 900,
    ...overrides,
  });

  it.each([
    [
      'negative subtotal',
      { subtotalCents: -100, discountCents: 0, totalCents: -100 },
      'orders_subtotal_cents_nonneg',
    ],
    [
      'negative discount',
      { subtotalCents: 1000, discountCents: -100, totalCents: 1100 },
      'orders_discount_cents_nonneg',
    ],
    [
      'negative total',
      { subtotalCents: 100, discountCents: 200, totalCents: -100 },
      'orders_total_cents_nonneg',
    ],
  ])('rejects an order with %s', async (_name, values, constraint) => {
    const cart = await createCart(db, cleanup);
    expect(await constraintOf(db.insert(orders).values(order(cart.id, values)))).toBe(constraint);
  });

  it('accepts a zero total from a 100% discount', async () => {
    const cart = await createCart(db, cleanup);
    await db
      .insert(orders)
      .values(order(cart.id, { subtotalCents: 8990, discountCents: 8990, totalCents: 0 }));
  });

  async function orderWithProduct() {
    const cart = await createCart(db, cleanup);
    const product = await createProduct(db, cleanup);
    const [row] = await db.insert(orders).values(order(cart.id)).returning();
    return { orderId: row.id, productId: product.id };
  }

  it('rejects an order item with quantity 0', async () => {
    const { orderId, productId } = await orderWithProduct();
    expect(
      await constraintOf(
        db.insert(orderItems).values({ orderId, productId, quantity: 0, unitPriceCents: 1000 }),
      ),
    ).toBe('order_items_quantity_min');
  });

  it('rejects an order item with a negative unit price', async () => {
    const { orderId, productId } = await orderWithProduct();
    expect(
      await constraintOf(
        db.insert(orderItems).values({ orderId, productId, quantity: 1, unitPriceCents: -1 }),
      ),
    ).toBe('order_items_unit_price_cents_nonneg');
  });

  it('accepts a free item (unit price 0)', async () => {
    const { orderId, productId } = await orderWithProduct();
    await db.insert(orderItems).values({ orderId, productId, quantity: 1, unitPriceCents: 0 });
  });
});
