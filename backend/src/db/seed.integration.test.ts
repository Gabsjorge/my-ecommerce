import { count } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from './client';
import { products } from './schema';
import { runSeed } from './seed';

const pool = createPool(process.env.DATABASE_URL as string);
const db = createDb(pool);

afterAll(async () => {
  await pool.end();
});

describe('runSeed (integration)', () => {
  it('is idempotent: does not insert when the table is already populated', async () => {
    const result = await runSeed(db);
    expect(result.inserted).toBe(0);
    const [row] = await db.select({ value: count() }).from(products);
    expect(row.value).toBe(6);
  });
});
