import type { Request, Response } from 'express';
import { parseOrThrow } from '../../shared/validation';
import {
  addItemBodySchema,
  applyCouponBodySchema,
  cartItemParamsSchema,
  cartParamsSchema,
  updateItemBodySchema,
} from './cart.schemas';
import type { CartService } from './cart.service';

// Parses and validates input, then delegates; the service never sees req/res.
// Express 5 forwards rejected promises to the error handler.
export class CartController {
  constructor(private readonly service: CartService) {}

  create = async (_req: Request, res: Response): Promise<void> => {
    res.status(201).json(await this.service.createCart());
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    res.json(await this.service.getCart(cartId));
  };

  addItem = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    const { productId, quantity } = parseOrThrow(addItemBodySchema, req.body);
    res.json(await this.service.addItem(cartId, productId, quantity));
  };

  updateItem = async (req: Request, res: Response): Promise<void> => {
    const { cartId, productId } = parseOrThrow(cartItemParamsSchema, req.params);
    const { quantity } = parseOrThrow(updateItemBodySchema, req.body);
    res.json(await this.service.updateItemQuantity(cartId, productId, quantity));
  };

  removeItem = async (req: Request, res: Response): Promise<void> => {
    const { cartId, productId } = parseOrThrow(cartItemParamsSchema, req.params);
    res.json(await this.service.removeItem(cartId, productId));
  };

  applyCoupon = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    const { code } = parseOrThrow(applyCouponBodySchema, req.body);
    res.json(await this.service.applyCoupon(cartId, code));
  };

  removeCoupon = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    res.json(await this.service.removeCoupon(cartId));
  };

  checkout = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    res.json(await this.service.checkout(cartId));
  };

  edit = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    res.json(await this.service.edit(cartId));
  };

  abandon = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    res.json(await this.service.abandon(cartId));
  };

  confirm = async (req: Request, res: Response): Promise<void> => {
    const { cartId } = parseOrThrow(cartParamsSchema, req.params);
    res.status(201).json(await this.service.confirm(cartId));
  };
}
