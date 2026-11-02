import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { cartItems, carts, products } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCart, createCoupon, createProduct } from '../../test-support/factories';
import { CartRepository } from './cart.repository';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const repository = new CartRepository(db);

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

describe('CartRepository.create / lookup (integration)', () => {
  it('creates an empty cart without items or coupon (RF-001)', async () => {
    const now = new Date('2030-05-05T10:00:00Z');
    const cart = await repository.create(now);
    cleanup.trackCart(cart.id);

    expect(cart).toMatchObject({
      status: 'empty',
      couponId: null,
      lastActivityAt: now,
    });
    expect(await repository.findDetails(cart.id)).toEqual({
      cart,
      items: [],
      coupon: null,
    });
  });

  it('returns null for unknown carts', async () => {
    expect(await repository.findDetails(2147483647)).toBeNull();
    const locked = await db.transaction((tx) => new CartRepository(tx).lockById(2147483647));
    expect(locked).toBeNull();
  });

  it('locks an existing cart inside a transaction', async () => {
    const cart = await createCart(db, cleanup);
    const locked = await db.transaction((tx) => new CartRepository(tx).lockById(cart.id));
    expect(locked?.id).toBe(cart.id);
  });
});

describe('CartRepository items (integration)', () => {
  it('inserts, finds, updates and deletes a line', async () => {
    const product = await createProduct(db, cleanup, { priceCents: 1500 });
    const cart = await createCart(db, cleanup);

    await repository.insertItem(cart.id, product.id, 2, 1500);
    expect(await repository.findItem(cart.id, product.id)).toEqual({
      productId: product.id,
      name: product.name,
      quantity: 2,
      unitPriceCents: 1500,
    });

    await repository.updateQuantity(cart.id, product.id, 5);
    expect((await repository.findItem(cart.id, product.id))?.quantity).toBe(5);

    await repository.deleteItem(cart.id, product.id);
    expect(await repository.findItem(cart.id, product.id)).toBeNull();
  });

  it('keeps the frozen unit price when the product price changes (RN-004)', async () => {
    const product = await createProduct(db, cleanup, { priceCents: 1000 });
    const cart = await createCart(db, cleanup);
    await repository.insertItem(cart.id, product.id, 1, 1000);

    await db.update(products).set({ priceCents: 9999 }).where(eq(products.id, product.id));

    expect((await repository.findItem(cart.id, product.id))?.unitPriceCents).toBe(1000);
  });

  it('rejects a second line for the same product (RN-001)', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup);
    await repository.insertItem(cart.id, product.id, 1, 1000);

    expect(await constraintOf(repository.insertItem(cart.id, product.id, 1, 1000))).toBe(
      'cart_items_cart_id_product_id_unique',
    );
  });

  it('returns the items with product names ordered by product id', async () => {
    const a = await createProduct(db, cleanup);
    const b = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup);
    await repository.insertItem(cart.id, b.id, 1, 1000);
    await repository.insertItem(cart.id, a.id, 3, 1000);

    const details = await repository.findDetails(cart.id);
    expect(details?.items.map((i) => [i.productId, i.name, i.quantity])).toEqual([
      [a.id, a.name, 3],
      [b.id, b.name, 1],
    ]);
  });

  it('removes the lines when the cart is deleted (cascade)', async () => {
    const product = await createProduct(db, cleanup);
    const cart = await createCart(db, cleanup);
    await repository.insertItem(cart.id, product.id, 1, 1000);

    await db.delete(carts).where(eq(carts.id, cart.id));

    const rows = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
    expect(rows).toEqual([]);
  });
});

describe('CartRepository status, coupon and activity (integration)', () => {
  it('sets and clears the coupon, exposing it in the details', async () => {
    const coupon = await createCoupon(db, cleanup, { type: 'fixed', value: 2000 });
    const cart = await createCart(db, cleanup);

    await repository.setCoupon(cart.id, coupon.id);
    const withCoupon = await repository.findDetails(cart.id);
    expect(withCoupon?.cart.couponId).toBe(coupon.id);
    expect(withCoupon?.coupon).toEqual({
      id: coupon.id,
      code: coupon.code,
      type: 'fixed',
      value: 2000,
    });

    await repository.setCoupon(cart.id, null);
    const cleared = await repository.findDetails(cart.id);
    expect(cleared?.cart.couponId).toBeNull();
    expect(cleared?.coupon).toBeNull();
  });

  it('sets the status', async () => {
    const cart = await createCart(db, cleanup);
    await repository.setStatus(cart.id, 'with_items');
    expect((await repository.findDetails(cart.id))?.cart.status).toBe('with_items');
  });

  it('touch updates last_activity_at', async () => {
    const cart = await createCart(db, cleanup);
    const at = new Date('2031-02-02T12:00:00Z');
    await repository.touch(cart.id, at);
    expect((await repository.findDetails(cart.id))?.cart.lastActivityAt).toEqual(at);
  });
});

describe('CartRepository.abandonIfExpired (integration)', () => {
  const lastActivityAt = new Date('2030-01-01T00:00:00Z');
  const cutoff = new Date('2030-01-01T00:10:00Z');

  async function statusAndActivity(id: number) {
    const details = await repository.findDetails(id);
    return { status: details?.cart.status, lastActivityAt: details?.cart.lastActivityAt };
  }

  it.each(['with_items', 'in_checkout'] as const)(
    'abandons an expired %s cart without touching last_activity_at',
    async (status) => {
      const cart = await createCart(db, cleanup, { status, lastActivityAt });
      const old = new Date(cutoff.getTime() + 1);
      expect(await repository.abandonIfExpired(cart.id, old)).toBe(true);
      expect(await statusAndActivity(cart.id)).toEqual({ status: 'abandoned', lastActivityAt });
    },
  );

  it('does not abandon when last_activity_at equals the cutoff (strictly older only)', async () => {
    const cart = await createCart(db, cleanup, { status: 'with_items', lastActivityAt: cutoff });
    expect(await repository.abandonIfExpired(cart.id, cutoff)).toBe(false);
    expect((await statusAndActivity(cart.id)).status).toBe('with_items');
  });

  it('does not abandon a recent cart', async () => {
    const cart = await createCart(db, cleanup, {
      status: 'with_items',
      lastActivityAt: new Date(cutoff.getTime() + 1000),
    });
    expect(await repository.abandonIfExpired(cart.id, cutoff)).toBe(false);
  });

  it.each(['empty', 'order_created', 'abandoned'] as const)(
    'never touches a %s cart',
    async (status) => {
      const cart = await createCart(db, cleanup, { status, lastActivityAt });
      expect(await repository.abandonIfExpired(cart.id, new Date('2099-01-01T00:00:00Z'))).toBe(
        false,
      );
      expect((await statusAndActivity(cart.id)).status).toBe(status);
    },
  );
});
