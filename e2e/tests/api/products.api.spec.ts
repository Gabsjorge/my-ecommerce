import { expect, test } from '@playwright/test';

interface ApiProduct {
  id: number;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
}

test.describe('GET /api/products', () => {
  test('returns the envelope with 6 products', async ({ request }) => {
    const res = await request.get('/api/products');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(6);
    expect(body.data).toHaveLength(6);
  });

  test('each item has the expected fields and types', async ({ request }) => {
    const { data } = (await (await request.get('/api/products')).json()) as {
      data: ApiProduct[];
    };
    for (const item of data) {
      expect(Number.isInteger(item.id)).toBe(true);
      expect(typeof item.name).toBe('string');
      expect(typeof item.description).toBe('string');
      expect(Number.isInteger(item.priceCents)).toBe(true);
      expect(Number.isInteger(item.stock)).toBe(true);
    }
  });

  test('items are ordered by id', async ({ request }) => {
    const { data } = (await (await request.get('/api/products')).json()) as {
      data: ApiProduct[];
    };
    const ids = data.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  test('has at least one item out of stock', async ({ request }) => {
    const { data } = (await (await request.get('/api/products')).json()) as {
      data: ApiProduct[];
    };
    expect(data.some((p) => p.stock === 0)).toBe(true);
  });

  test('unknown route returns 404 in the standard error format', async ({ request }) => {
    const res = await request.get('/api/rota-inexistente');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });
});
