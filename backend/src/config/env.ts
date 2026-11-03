import { z } from 'zod';

export const DEFAULT_CART_INACTIVITY_TIMEOUT_SECONDS = 600;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  CART_INACTIVITY_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_CART_INACTIVITY_TIMEOUT_SECONDS),
});

export type Env = z.infer<typeof envSchema>;

// Pure function: easy to test without touching process.env.
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}

// The only place that reads process.env. Fails fast on startup.
export function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
