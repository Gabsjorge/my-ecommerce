import { defineConfig } from 'drizzle-kit';

// No dbCredentials: `generate` does not connect to the database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
