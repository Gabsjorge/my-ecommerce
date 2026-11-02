import { afterAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../../db/client';
import { ProductRepository } from './product.repository';

const pool = createPool(process.env.DATABASE_URL as string);
const repository = new ProductRepository(createDb(pool));

afterAll(async () => {
  await pool.end();
});

describe('ProductRepository.findAll (integration)', () => {
  it('returns the 6 seeded products ordered by id', async () => {
    const products = await repository.findAll();
    expect(products).toHaveLength(6);
    const ids = products.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('returns the expected types', async () => {
    const products = await repository.findAll();
    for (const product of products) {
      expect(Number.isInteger(product.priceCents)).toBe(true);
      expect(Number.isInteger(product.stock)).toBe(true);
      expect(typeof product.name).toBe('string');
      expect(typeof product.description).toBe('string');
    }
  });
});
