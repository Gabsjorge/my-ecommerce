import { AppError } from '../../shared/errors';

export class CouponNotFoundError extends AppError {
  constructor() {
    super('COUPON_NOT_FOUND', 'Coupon not found', 404);
  }
}

export class CouponAlreadyAppliedError extends AppError {
  constructor() {
    super('COUPON_ALREADY_APPLIED', 'The cart already has a coupon applied', 409);
  }
}

export class CouponExpiredError extends AppError {
  constructor() {
    super('COUPON_EXPIRED', 'Coupon expired', 422);
  }
}

export class CouponAlreadyUsedError extends AppError {
  constructor() {
    super('COUPON_ALREADY_USED', 'Coupon already used', 422);
  }
}

export class CouponMinOrderNotMetError extends AppError {
  constructor() {
    super('COUPON_MIN_ORDER_NOT_MET', 'Order does not reach the coupon minimum', 422);
  }
}
