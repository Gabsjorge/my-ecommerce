import { z } from 'zod';
import { ValidationError } from './errors';

// Largest value of a Postgres `integer` column; anything above would overflow.
export const MAX_INT32 = 2147483647;

// Positive integer <= MAX_INT32. Accepts a digits-only string (path params) or an integer number (JSON body).
export const positiveIntParam = z
  .union([z.string().regex(/^\d+$/), z.number()])
  .transform((value) => (typeof value === 'string' ? Number(value) : value))
  .pipe(z.number().int().min(1).max(MAX_INT32));

// Throws ValidationError (400) with issue paths and messages only; the received values are not echoed.
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ValidationError('Invalid input', details);
  }
  return result.data;
}
