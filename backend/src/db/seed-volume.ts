import { like } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { createDb, createPool, type Database } from './client';
import { cartItems, carts, coupons, orderItems, orders, products } from './schema';
import { generateVolumeDataset, VOLUME_COUPON_PREFIX } from './seed-volume.data';

// High-volume dataset for load and exploratory testing. Opt-in and development only: the E2E suite
// asserts the 10 fixed products of seed.ts, so this seed is never wired into the compose files.

const BATCH_SIZE = 500;

export interface VolumeSeedResult {
  skipped: boolean;
  products: number;
  coupons: number;
  carts: number;
  cartItems: number;
  orders: number;
  orderItems: number;
}

function chunk<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

function expectSameLength(table: string, inserted: number, expected: number): void {
  if (inserted !== expected) {
    throw new Error(`Inserted ${inserted} ${table} row(s), expected ${expected}`);
  }
}

// Idempotent as a whole: everything runs in one transaction and is guarded by the 'VOL-' coupon marker,
// so a populated database is left untouched on re-runs.
export async function runVolumeSeed(
  db: Database,
  now: Date = new Date(),
): Promise<VolumeSeedResult> {
  return db.transaction(async (tx) => {
    const [marker] = await tx
      .select({ id: coupons.id })
      .from(coupons)
      .where(like(coupons.code, `${VOLUME_COUPON_PREFIX}%`))
      .limit(1);
    const result: VolumeSeedResult = {
      skipped: true,
      products: 0,
      coupons: 0,
      carts: 0,
      cartItems: 0,
      orders: 0,
      orderItems: 0,
    };
    if (marker) return result;

    const data = generateVolumeDataset({ now });

    const productIds: number[] = [];
    for (const rows of chunk(data.products)) {
      const inserted = await tx.insert(products).values(rows).returning({ id: products.id });
      productIds.push(...inserted.map((r) => r.id));
    }
    expectSameLength('products', productIds.length, data.products.length);

    const couponIds: number[] = [];
    for (const rows of chunk(data.coupons)) {
      const inserted = await tx.insert(coupons).values(rows).returning({ id: coupons.id });
      couponIds.push(...inserted.map((r) => r.id));
    }
    expectSameLength('coupons', couponIds.length, data.coupons.length);

    // RETURNING follows the VALUES order of a multi-row INSERT, which maps generated ids back to the dataset.
    const cartIds: number[] = [];
    for (const rows of chunk(data.carts)) {
      const inserted = await tx
        .insert(carts)
        .values(
          rows.map((c) => ({
            status: c.status,
            couponId: c.couponIndex === null ? null : couponIds[c.couponIndex],
            createdAt: c.createdAt,
            lastActivityAt: c.lastActivityAt,
          })),
        )
        .returning({ id: carts.id });
      cartIds.push(...inserted.map((r) => r.id));
    }
    expectSameLength('carts', cartIds.length, data.carts.length);

    const cartItemRows = data.carts.flatMap((c, i) =>
      c.items.map((item) => ({
        cartId: cartIds[i],
        productId: productIds[item.productIndex],
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
    );
    for (const rows of chunk(cartItemRows)) await tx.insert(cartItems).values(rows);

    const orderCartIndexes = data.carts.flatMap((c, i) => (c.order ? [i] : []));
    const orderIds = new Map<number, number>();
    for (const indexes of chunk(orderCartIndexes)) {
      const inserted = await tx
        .insert(orders)
        .values(
          indexes.map((i) => {
            const cart = data.carts[i];
            const order = cart.order!;
            return {
              cartId: cartIds[i],
              status: 'created',
              subtotalCents: order.subtotalCents,
              discountCents: order.discountCents,
              totalCents: order.totalCents,
              couponId: cart.couponIndex === null ? null : couponIds[cart.couponIndex],
              createdAt: order.createdAt,
            };
          }),
        )
        .returning({ id: orders.id });
      expectSameLength('orders', inserted.length, indexes.length);
      indexes.forEach((cartIndex, n) => orderIds.set(cartIndex, inserted[n].id));
    }

    const orderItemRows = orderCartIndexes.flatMap((i) =>
      data.carts[i].items.map((item) => ({
        orderId: orderIds.get(i)!,
        productId: productIds[item.productIndex],
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
    );
    for (const rows of chunk(orderItemRows)) await tx.insert(orderItems).values(rows);

    return {
      skipped: false,
      products: productIds.length,
      coupons: couponIds.length,
      carts: cartIds.length,
      cartItems: cartItemRows.length,
      orders: orderIds.size,
      orderItems: orderItemRows.length,
    };
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV !== 'development') {
    throw new Error(`Refusing to run the volume seed with NODE_ENV=${env.NODE_ENV}`);
  }
  const pool = createPool(env.DATABASE_URL);
  try {
    const result = await runVolumeSeed(createDb(pool));
    if (result.skipped) {
      console.log('Volume seed skipped: already applied (coupons with prefix VOL- exist)');
    } else {
      console.log(`Volume seed finished: ${JSON.stringify(result)}`);
    }
  } finally {
    await pool.end();
  }
}

// CLI guard: importing runVolumeSeed in tests must not execute the seed.
if (require.main === module) {
  main().catch((error) => {
    console.error('Volume seed failed', error);
    process.exit(1);
  });
}
