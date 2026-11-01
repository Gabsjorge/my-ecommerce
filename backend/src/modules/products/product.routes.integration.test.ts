import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createDb, createPool, type Database } from '../../db/client';

const pool = createPool(process.env.DATABASE_URL as string);
const app = createApp({ db: createDb(pool) });

afterAll(async () => {
  await pool.end();
});

describe('GET /api/products (integration)', () => {
  it('returns 200 with the { data, total } envelope', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBe(res.body.data.length);
  });
});

describe('unknown routes (integration)', () => {
  it('returns 404 in the standard error format', async () => {
    const res = await request(app).get('/rota-inexistente');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
  });
});

describe('GET /health (integration)', () => {
  it('returns 200 when the database is available', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database ping fails', async () => {
    const brokenDb = {
      execute: () => Promise.reject(new Error('db down')),
    } as unknown as Database;
    const res = await request(createApp({ db: brokenDb })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
