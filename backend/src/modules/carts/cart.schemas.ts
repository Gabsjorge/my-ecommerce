import { z } from 'zod';
import { couponCodeSchema } from '../coupons/coupon.code';
import { MAX_INT32, positiveIntParam } from '../../shared/validation';

// JSON bodies must carry real numbers: strings and decimals are rejected (RN-002, general validation).
const bodyPositiveInt = z.number().int().min(1).max(MAX_INT32);

export const cartParamsSchema = z.object({ cartId: positiveIntParam });

export const cartItemParamsSchema = z.object({
  cartId: positiveIntParam,
  productId: positiveIntParam,
});

export const addItemBodySchema = z.object({
  productId: bodyPositiveInt,
  quantity: bodyPositiveInt,
});

export const updateItemBodySchema = z.object({ quantity: bodyPositiveInt });

// Normalized and format-checked here, so an invalid code fails with 400 before the cart state is read.
export const applyCouponBodySchema = z.object({ code: couponCodeSchema });
