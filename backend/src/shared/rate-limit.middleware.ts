import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RateLimitedError } from './errors';

const WINDOW_MS = 60_000;

// Fixed one-minute window per client IP, in memory (single backend instance). Errors go through the shared handler.
export function createRateLimiter(maxRequests: number): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: maxRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitedError()),
  });
}
