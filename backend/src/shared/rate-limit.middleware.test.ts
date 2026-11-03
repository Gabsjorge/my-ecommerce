import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { Database } from '../db/client';

// Requests below are rejected by input validation before any query, so no real database is needed.
const fakeDb = {} as Database;

describe('rate limiting', () => {
  it('answers 429 RATE_LIMITED on cart creation above the sensitive limit', async () => {
    const app = createApp({
      db: fakeDb,
      rateLimit: { maxPerMinute: 100, sensitiveMaxPerMinute: 2 },
    });
    const hit = () => supertest(app).post('/api/carts/abc/coupon').send({});

    expect((await hit()).status).toBe(400);
    expect((await hit()).status).toBe(400);
    const limited = await hit();
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' },
    });
    expect(limited.headers['ratelimit']).toBeDefined();
  });

  it('applies the global limit to every /api route', async () => {
    const app = createApp({
      db: fakeDb,
      rateLimit: { maxPerMinute: 1, sensitiveMaxPerMinute: 10 },
    });

    expect((await supertest(app).get('/api/carts/abc')).status).toBe(400);
    expect((await supertest(app).get('/api/carts/abc')).status).toBe(429);
  });

  it('does not limit when no limits are configured', async () => {
    const app = createApp({ db: fakeDb });
    for (let i = 0; i < 5; i++) {
      expect((await supertest(app).get('/api/carts/abc')).status).toBe(400);
    }
  });

  it('sends security headers and hides the framework', async () => {
    const res = await supertest(createApp({ db: fakeDb })).get('/api/carts/abc');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
