import type express from 'express';
import type { Pool } from 'pg';
import { createApp } from '../app';
import { createDb, createPool, type Database } from '../db/client';

export interface TestApp {
  app: express.Express;
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  clock?: () => Date;
  cartInactivityTimeoutSeconds?: number;
}

// Integration-test composition: real database from DATABASE_URL, same wiring as production.
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set: integration tests need a migrated and seeded Postgres (run `make test-backend`).',
    );
  }
  const pool = createPool(url);
  const db = createDb(pool);
  return { app: createApp({ db, ...options }), db, pool, close: () => pool.end() };
}
