import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { products } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createProduct } from '../../test-support/factories';
import { ProductRepository } from './product.repository';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const repository = new ProductRepository(db);

afterEach(() => cleanup.run(db));
afterAll(() => close());

describe('ProductRepository.findAll (integration)', () => {
  it('returns the 10 seeded products ordered by id', async () => {
    const found = await repository.findAll();
    expect(found).toHaveLength(10);
    const ids = found.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('returns the expected types', async () => {
    const found = await repository.findAll();
    for (const product of found) {
      expect(Number.isInteger(product.priceCents)).toBe(true);
      expect(Number.isInteger(product.stock)).toBe(true);
      expect(typeof product.name).toBe('string');
      expect(typeof product.description).toBe('string');
    }
  });
});

describe('ProductRepository.findById (integration)', () => {
  it('returns the product when it exists', async () => {
    const created = await createProduct(db, cleanup, { priceCents: 1234, stock: 7 });
    const found = await repository.findById(created.id);
    expect(found).toEqual({
      id: created.id,
      name: created.name,
      description: created.description,
      priceCents: 1234,
      stock: 7,
    });
  });

  it('returns null when it does not exist', async () => {
    expect(await repository.findById(2147483647)).toBeNull();
  });
});

describe('ProductRepository.lockByIds (integration)', () => {
  it('returns the products ordered by id regardless of input order', async () => {
    const a = await createProduct(db, cleanup);
    const b = await createProduct(db, cleanup);
    const locked = await db.transaction((tx) => new ProductRepository(tx).lockByIds([b.id, a.id]));
    expect(locked.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('returns an empty list for no ids', async () => {
    expect(await repository.lockByIds([])).toEqual([]);
  });

  it('blocks a second transaction until the first one commits (RN-008)', async () => {
    const product = await createProduct(db, cleanup);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstHasLock!: () => void;
    const firstLocked = new Promise<void>((resolve) => (firstHasLock = resolve));

    const first = db.transaction(async (tx) => {
      await new ProductRepository(tx).lockByIds([product.id]);
      events.push('first locked');
      firstHasLock();
      await firstMayCommit;
      events.push('first commit');
    });

    await firstLocked;
    const second = db.transaction(async (tx) => {
      await new ProductRepository(tx).lockByIds([product.id]);
      events.push('second locked');
    });

    // Give the second transaction time to hit the lock; it must still be waiting.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events).toEqual(['first locked']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first locked', 'first commit', 'second locked']);
  });
});

describe('ProductRepository.decrementStock (integration)', () => {
  it('decrements the stock and reports success', async () => {
    const product = await createProduct(db, cleanup, { stock: 5 });
    expect(await repository.decrementStock(product.id, 3)).toBe(true);
    expect((await repository.findById(product.id))?.stock).toBe(2);
  });

  it('allows decrementing down to exactly zero', async () => {
    const product = await createProduct(db, cleanup, { stock: 2 });
    expect(await repository.decrementStock(product.id, 2)).toBe(true);
    expect((await repository.findById(product.id))?.stock).toBe(0);
  });

  it('refuses to go negative and leaves the stock untouched', async () => {
    const product = await createProduct(db, cleanup, { stock: 2 });
    expect(await repository.decrementStock(product.id, 3)).toBe(false);
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(2);
  });

  it('reports false for an unknown product', async () => {
    expect(await repository.decrementStock(2147483647, 1)).toBe(false);
  });
});
