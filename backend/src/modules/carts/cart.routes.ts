import { Router } from 'express';
import type { CartController } from './cart.controller';

// Mounted at /api/carts. No path may end in `.js`: nginx serves those from disk (see nginx.conf).
export function createCartRoutes(controller: CartController): Router {
  const router = Router();
  router.post('/', controller.create);
  router.get('/:cartId', controller.get);
  router.post('/:cartId/items', controller.addItem);
  router.patch('/:cartId/items/:productId', controller.updateItem);
  router.delete('/:cartId/items/:productId', controller.removeItem);
  router.post('/:cartId/coupon', controller.applyCoupon);
  router.delete('/:cartId/coupon', controller.removeCoupon);
  router.post('/:cartId/checkout', controller.checkout);
  router.post('/:cartId/edit', controller.edit);
  router.post('/:cartId/abandon', controller.abandon);
  router.post('/:cartId/confirm', controller.confirm);
  return router;
}
