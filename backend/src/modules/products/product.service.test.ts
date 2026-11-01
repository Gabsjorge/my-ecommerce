import { describe, expect, it, vi } from 'vitest';
import { ProductService } from './product.service';
import type { Product, ProductRepositoryPort } from './product.types';

const sample: Product[] = [
  { id: 1, name: 'A', description: 'a', priceCents: 100, stock: 1 },
  { id: 2, name: 'B', description: 'b', priceCents: 200, stock: 0 },
];

function makeRepo(products: Product[]): ProductRepositoryPort {
  return { findAll: vi.fn().mockResolvedValue(products) };
}

describe('ProductService.list', () => {
  it('returns data with total equal to data.length', async () => {
    const result = await new ProductService(makeRepo(sample)).list();
    expect(result).toEqual({ data: sample, total: 2 });
  });

  it('returns an empty list without error', async () => {
    const result = await new ProductService(makeRepo([])).list();
    expect(result).toEqual({ data: [], total: 0 });
  });
});
