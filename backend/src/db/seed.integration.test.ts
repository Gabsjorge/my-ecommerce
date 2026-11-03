import { count, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from './client';
import { coupons, products } from './schema';
import { runSeed, seedCoupons, seedProducts } from './seed';

const pool = createPool(process.env.DATABASE_URL as string);
const db = createDb(pool);

const newProductNames = seedProducts.slice(6).map((p) => p.name);

afterAll(async () => {
  // Restores the seed even if a test failed halfway, so later files still find DESC10/USADO10.
  try {
    await runSeed(db);
  } finally {
    await pool.end();
  }
});

describe('runSeed (integration)', () => {
  it('is idempotent: a second run inserts nothing and does not duplicate rows', async () => {
    await runSeed(db);
    const result = await runSeed(db);
    expect(result).toEqual({ insertedProducts: 0, insertedCoupons: 0 });

    const [productRow] = await db.select({ value: count() }).from(products);
    const [couponRow] = await db.select({ value: count() }).from(coupons);
    expect(productRow.value).toBe(seedProducts.length);
    expect(couponRow.value).toBe(seedCoupons.length);
  });

  it('adds only the missing rows to a database populated before the cart feature', async () => {
    // Simulates a dev database that has the original 6 products and no coupons.
    await db.delete(products).where(inArray(products.name, newProductNames));
    await db.delete(coupons).where(inArray(coupons.code, ['DESC10', 'USADO10']));

    const result = await runSeed(db);

    expect(result).toEqual({ insertedProducts: newProductNames.length, insertedCoupons: 2 });
    const [productRow] = await db.select({ value: count() }).from(products);
    expect(productRow.value).toBe(seedProducts.length);
  });
});
