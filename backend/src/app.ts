import express from 'express';
import helmet from 'helmet';
import { DEFAULT_CART_INACTIVITY_TIMEOUT_SECONDS } from './config/env';
import { pingDb, type Database } from './db/client';
import { errorHandler, notFoundHandler } from './shared/error-handler.middleware';
import { createRateLimiter } from './shared/rate-limit.middleware';
import { CartController } from './modules/carts/cart.controller';
import { CartRepository } from './modules/carts/cart.repository';
import { createCartRoutes } from './modules/carts/cart.routes';
import { CartService } from './modules/carts/cart.service';
import { DrizzleUnitOfWork } from './modules/carts/cart.unit-of-work';
import type { Clock } from './modules/carts/cart.types';
import { HealthController } from './modules/health/health.controller';
import { createHealthRoutes } from './modules/health/health.routes';
import { ProductController } from './modules/products/product.controller';
import { ProductRepository } from './modules/products/product.repository';
import { createProductRoutes } from './modules/products/product.routes';
import { ProductService } from './modules/products/product.service';

export interface AppDeps {
  db: Database;
  // Injectable for tests; defaults to the system clock.
  clock?: Clock;
  // Defaults to the env schema default.
  cartInactivityTimeoutSeconds?: number;
  // Requests per minute and client IP. Omitted means no limiting (tests); server.ts always sets it.
  rateLimit?: { maxPerMinute: number; sensitiveMaxPerMinute: number };
}

// Manual composition root (no DI framework). Does not call listen.
export function createApp({
  db,
  clock = () => new Date(),
  cartInactivityTimeoutSeconds = DEFAULT_CART_INACTIVITY_TIMEOUT_SECONDS,
  rateLimit,
}: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // One reverse proxy (nginx) sits in front and overwrites X-Forwarded-For with the real client IP.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  app.use('/health', createHealthRoutes(new HealthController(() => pingDb(db))));

  const productController = new ProductController(new ProductService(new ProductRepository(db)));
  if (rateLimit) {
    app.use('/api', createRateLimiter(rateLimit.maxPerMinute));
    // Cart creation and coupon guesses are the abuse-prone entry points.
    const sensitive = createRateLimiter(rateLimit.sensitiveMaxPerMinute);
    app.post('/api/carts', sensitive);
    app.post('/api/carts/:cartId/coupon', sensitive);
  }

  app.use('/api/products', createProductRoutes(productController));

  const cartService = new CartService({
    carts: new CartRepository(db),
    unitOfWork: new DrizzleUnitOfWork(db),
    clock,
    inactivityTimeoutMs: cartInactivityTimeoutSeconds * 1000,
  });
  app.use('/api/carts', createCartRoutes(new CartController(cartService)));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
