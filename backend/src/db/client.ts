import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;

// Transaction handle received by `db.transaction(async (tx) => ...)`.
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// Repositories accept either, so the same code runs inside or outside a transaction.
export type Executor = Database | Tx;

// Infrastructure check used by /health (not a business query).
export async function pingDb(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
