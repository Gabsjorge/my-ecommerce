import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { coupons, orders, products } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCart, createCoupon, createProduct } from '../../test-support/factories';
import { DrizzleUnitOfWork } from './cart.unit-of-work';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const unitOfWork = new DrizzleUnitOfWork(db);

afterEach(() => cleanup.run(db));
afterAll(() => close());

// Mimics the confirmation steps (RF-011) so the tests can fail in the middle of them.
async function confirmLike(
  ids: { cartId: number; productId: number; couponId: number },
  failAfterWrites: boolean,
) {
  return unitOfWork.run(
    async ({ carts, coupons: couponRepo, products: productRepo, orders: orderRepo }) => {
      await productRepo.decrementStock(ids.productId, 2);
      const order = await orderRepo.create(
        {
          cartId: ids.cartId,
          subtotalCents: 2000,
          discountCents: 200,
          totalCents: 1800,
          couponId: ids.couponId,
        },
        [{ productId: ids.productId, quantity: 2, unitPriceCents: 1000 }],
      );
      await couponRepo.markUsed(ids.couponId, new Date());
      await carts.setStatus(ids.cartId, 'order_created');
      if (failAfterWrites) throw new Error('injected failure');
      return order;
    },
  );
}

async function setup() {
  const product = await createProduct(db, cleanup, { stock: 5 });
  const coupon = await createCoupon(db, cleanup);
  const cart = await createCart(db, cleanup, { status: 'in_checkout', couponId: coupon.id });
  return { cartId: cart.id, productId: product.id, couponId: coupon.id };
}

async function snapshot(ids: { cartId: number; productId: number; couponId: number }) {
  const [product] = await db.select().from(products).where(eq(products.id, ids.productId));
  const [coupon] = await db.select().from(coupons).where(eq(coupons.id, ids.couponId));
  const orderRows = await db.select().from(orders).where(eq(orders.cartId, ids.cartId));
  const [cart] = await db.query.carts.findMany({
    where: (c, { eq: equals }) => equals(c.id, ids.cartId),
  });
  return {
    stock: product.stock,
    couponUsed: coupon.usedAt !== null,
    orders: orderRows.length,
    cartStatus: cart.status,
  };
}

describe('DrizzleUnitOfWork (integration)', () => {
  it('commits every write when the work succeeds and returns its value', async () => {
    const ids = await setup();

    const order = await confirmLike(ids, false);

    expect(order.cartId).toBe(ids.cartId);
    expect(await snapshot(ids)).toEqual({
      stock: 3,
      couponUsed: true,
      orders: 1,
      cartStatus: 'order_created',
    });
  });

  it('rolls everything back when the work throws after the writes (RN-021)', async () => {
    const ids = await setup();

    await expect(confirmLike(ids, true)).rejects.toThrow('injected failure');

    expect(await snapshot(ids)).toEqual({
      stock: 5,
      couponUsed: false,
      orders: 0,
      cartStatus: 'in_checkout',
    });
  });

  it('lets the repositories see each other writes inside the same transaction', async () => {
    const ids = await setup();

    const stockSeenInside = await unitOfWork.run(async ({ products: productRepo }) => {
      await productRepo.decrementStock(ids.productId, 1);
      const [locked] = await productRepo.lockByIds([ids.productId]);
      return locked.stock;
    });

    expect(stockSeenInside).toBe(4);
  });
});
