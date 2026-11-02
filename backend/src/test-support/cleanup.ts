import { inArray, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { cartItems, carts, coupons, orderItems, orders, products } from '../db/schema';

export interface Cleanup {
  trackProduct: (id: number) => void;
  trackCoupon: (id: number) => void;
  trackCart: (id: number) => void;
  run: (db: Database) => Promise<void>;
}

// Records what a test created and deletes only that, in FK order, so seed counts stay intact.
export function createCleanup(): Cleanup {
  const productIds = new Set<number>();
  const couponIds = new Set<number>();
  const cartIds = new Set<number>();

  return {
    trackProduct: (id) => void productIds.add(id),
    trackCoupon: (id) => void couponIds.add(id),
    trackCart: (id) => void cartIds.add(id),
    async run(db) {
      const products_ = [...productIds];
      const coupons_ = [...couponIds];
      const carts_ = [...cartIds];

      await db.transaction(async (tx) => {
        const orderRows =
          carts_.length + coupons_.length > 0
            ? await tx
                .select({ id: orders.id })
                .from(orders)
                .where(
                  or(
                    carts_.length ? inArray(orders.cartId, carts_) : undefined,
                    coupons_.length ? inArray(orders.couponId, coupons_) : undefined,
                  ),
                )
            : [];
        const orderIds = orderRows.map((row) => row.id);

        if (orderIds.length) {
          await tx.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
          await tx.delete(orders).where(inArray(orders.id, orderIds));
        }
        if (products_.length) {
          await tx.delete(orderItems).where(inArray(orderItems.productId, products_));
          await tx.delete(cartItems).where(inArray(cartItems.productId, products_));
        }
        if (carts_.length) {
          await tx.delete(cartItems).where(inArray(cartItems.cartId, carts_));
          await tx.delete(carts).where(inArray(carts.id, carts_));
        }
        if (coupons_.length) await tx.delete(coupons).where(inArray(coupons.id, coupons_));
        if (products_.length) await tx.delete(products).where(inArray(products.id, products_));
      });

      productIds.clear();
      couponIds.clear();
      cartIds.clear();
    },
  };
}
