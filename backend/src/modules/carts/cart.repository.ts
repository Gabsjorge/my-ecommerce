import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { cartItems, carts, coupons, products } from '../../db/schema';
import type {
  CartDetails,
  CartItemRecord,
  CartRecord,
  CartRepositoryPort,
  CartStatus,
} from './cart.types';

type CartRow = typeof carts.$inferSelect;

function toCart(row: CartRow): CartRecord {
  return {
    id: row.id,
    status: row.status as CartStatus,
    couponId: row.couponId,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
  };
}

const itemColumns = {
  productId: cartItems.productId,
  name: products.name,
  quantity: cartItems.quantity,
  unitPriceCents: cartItems.unitPriceCents,
};

export class CartRepository implements CartRepositoryPort {
  constructor(private readonly db: Executor) {}

  async create(now: Date): Promise<CartRecord> {
    const [row] = await this.db.insert(carts).values({ lastActivityAt: now }).returning();
    return toCart(row);
  }

  async lockById(id: number): Promise<CartRecord | null> {
    const [row] = await this.db.select().from(carts).where(eq(carts.id, id)).for('update');
    return row ? toCart(row) : null;
  }

  async findDetails(id: number): Promise<CartDetails | null> {
    const [row] = await this.db
      .select({ cart: carts, coupon: coupons })
      .from(carts)
      .leftJoin(coupons, eq(coupons.id, carts.couponId))
      .where(eq(carts.id, id));
    if (!row) return null;

    const items = await this.db
      .select(itemColumns)
      .from(cartItems)
      .innerJoin(products, eq(products.id, cartItems.productId))
      .where(eq(cartItems.cartId, id))
      .orderBy(asc(cartItems.productId));

    return {
      cart: toCart(row.cart),
      items,
      coupon: row.coupon
        ? {
            id: row.coupon.id,
            code: row.coupon.code,
            type: row.coupon.type as 'percentage' | 'fixed',
            value: row.coupon.value,
          }
        : null,
    };
  }

  async findItem(cartId: number, productId: number): Promise<CartItemRecord | null> {
    const [row] = await this.db
      .select(itemColumns)
      .from(cartItems)
      .innerJoin(products, eq(products.id, cartItems.productId))
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
    return row ?? null;
  }

  async insertItem(
    cartId: number,
    productId: number,
    quantity: number,
    unitPriceCents: number,
  ): Promise<void> {
    await this.db.insert(cartItems).values({ cartId, productId, quantity, unitPriceCents });
  }

  async updateQuantity(cartId: number, productId: number, quantity: number): Promise<void> {
    await this.db
      .update(cartItems)
      .set({ quantity })
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  }

  async deleteItem(cartId: number, productId: number): Promise<void> {
    await this.db
      .delete(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  }

  async setStatus(cartId: number, status: CartStatus): Promise<void> {
    await this.db.update(carts).set({ status }).where(eq(carts.id, cartId));
  }

  async setCoupon(cartId: number, couponId: number | null): Promise<void> {
    await this.db.update(carts).set({ couponId }).where(eq(carts.id, cartId));
  }

  async touch(cartId: number, at: Date): Promise<void> {
    await this.db.update(carts).set({ lastActivityAt: at }).where(eq(carts.id, cartId));
  }

  async abandonIfExpired(cartId: number, cutoff: Date): Promise<boolean> {
    const updated = await this.db
      .update(carts)
      .set({ status: 'abandoned' })
      .where(
        and(
          eq(carts.id, cartId),
          inArray(carts.status, ['with_items', 'in_checkout']),
          lt(carts.lastActivityAt, cutoff),
        ),
      )
      .returning({ id: carts.id });
    return updated.length > 0;
  }
}
