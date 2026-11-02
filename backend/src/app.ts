import express from 'express';
import { pingDb, type Database } from './db/client';
import { errorHandler, notFoundHandler } from './shared/error-handler.middleware';
import { HealthController } from './modules/health/health.controller';
import { createHealthRoutes } from './modules/health/health.routes';
import { ProductController } from './modules/products/product.controller';
import { ProductRepository } from './modules/products/product.repository';
import { createProductRoutes } from './modules/products/product.routes';
import { ProductService } from './modules/products/product.service';

export interface AppDeps {
  db: Database;
}

// Manual composition root (no DI framework). Does not call listen.
export function createApp({ db }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.use('/health', createHealthRoutes(new HealthController(() => pingDb(db))));

  const productController = new ProductController(new ProductService(new ProductRepository(db)));
  app.use('/api/products', createProductRoutes(productController));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
