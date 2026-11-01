import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env';
import { createDb, createPool } from './client';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  try {
    await migrate(createDb(pool), { migrationsFolder: './drizzle' });
    console.log('Migrations applied');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Migration failed', error);
    process.exit(1);
  });
}
