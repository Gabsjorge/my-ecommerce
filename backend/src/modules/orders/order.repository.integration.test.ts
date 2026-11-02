import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { orderItems } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCart, createCoupon, createProduct } from '../../test-support/factories';
import { OrderRepository } from './order.repository';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const repository = new OrderRepository(db);

afterEach(() => cleanup.run(db));
afterAll(() => close());

async function constraintOf(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { cause?: { constraint?: string } }).cause?.constraint;
  }
  return undefined;
}

function totals(subtotalCents: number, discountCents: number) {
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

describe('OrderRepository.create (integration)', () => {
  it('creates the order with status created and persists its items (RF-011)', async () => {
    const product = await createProduct(db, cleanup);
    const coupon = await createCoupon(db, cleanup);
    const cart = await createCart(db, cleanup);
    const items = [{ productId: product.id, quantity: 2, unitPriceCents: 1500 }];

    const order = await repository.create(
      { cartId: cart.id, ...totals(3000, 300), couponId: coupon.id },
      items,
    );

    expect(order).toMatchObject({
      cartId: cart.id,
      status: 'created',
      subtotalCents: 3000,
      discountCents: 300,
      totalCents: 2700,
      couponId: coupon.id,
      items,
    });
    expect(order.createdAt).toBeInstanceOf(Date);
    const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: product.id, quantity: 2, unitPriceCents: 1500 });
  });

  it('allows several orders without coupon', async () => {
    const first = await createCart(db, cleanup);
    const second = await createCart(db, cleanup);
    const a = await repository.create({ cartId: first.id, ...totals(1000, 0), couponId: null }, []);
    const b = await repository.create(
      { cartId: second.id, ...totals(1000, 0), couponId: null },
      [],
    );
    expect(a.id).not.toBe(b.id);
  });

  it('rejects a second order with the same coupon (RN-013)', async () => {
    const coupon = await createCoupon(db, cleanup);
    const first = await createCart(db, cleanup);
    const second = await createCart(db, cleanup);
    await repository.create({ cartId: first.id, ...totals(1000, 100), couponId: coupon.id }, []);

    expect(
      await constraintOf(
        repository.create({ cartId: second.id, ...totals(1000, 100), couponId: coupon.id }, []),
      ),
    ).toBe('orders_coupon_id_unique');
  });

  it('rejects a second order for the same cart', async () => {
    const cart = await createCart(db, cleanup);
    await repository.create({ cartId: cart.id, ...totals(1000, 0), couponId: null }, []);

    expect(
      await constraintOf(
        repository.create({ cartId: cart.id, ...totals(1000, 0), couponId: null }, []),
      ),
    ).toBe('orders_cart_id_unique');
  });

  it('rejects total different from subtotal minus discount (RN-015)', async () => {
    const cart = await createCart(db, cleanup);

    expect(
      await constraintOf(
        repository.create(
          {
            cartId: cart.id,
            subtotalCents: 1000,
            discountCents: 100,
            totalCents: 1000,
            couponId: null,
          },
          [],
        ),
      ),
    ).toBe('orders_total_consistent');
  });
});
