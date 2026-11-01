import { createApp } from './app';
import { loadEnv } from './config/env';
import { createDb, createPool } from './db/client';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const app = createApp({ db: createDb(pool) });

const server = app.listen(env.BACKEND_PORT, '0.0.0.0', () => {
  console.log(`Backend listening on port ${env.BACKEND_PORT}`);
});

function shutdown(): void {
  server.close(() => {
    pool
      .end()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Error closing the pool', error);
        process.exit(1);
      });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
