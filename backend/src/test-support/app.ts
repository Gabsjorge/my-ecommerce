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
  const pool = createPool(process.env.DATABASE_URL as string);
  const db = createDb(pool);
  return { app: createApp({ db, ...options }), db, pool, close: () => pool.end() };
}
