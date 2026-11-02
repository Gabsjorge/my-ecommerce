import { Router } from 'express';
import type { ProductController } from './product.controller';

export function createProductRoutes(controller: ProductController): Router {
  const router = Router();
  router.get('/', controller.list);
  return router;
}
