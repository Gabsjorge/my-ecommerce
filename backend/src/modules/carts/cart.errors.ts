import { AppError } from '../../shared/errors';

export class InvalidCartStateError extends AppError {
  constructor(operation: string, status: string) {
    super(
      'INVALID_CART_STATE',
      `Operation ${operation} is not allowed when the cart is in state '${status}'`,
      409,
      { operation, status },
    );
  }
}

export class CartNotFoundError extends AppError {
  constructor() {
    super('CART_NOT_FOUND', 'Cart not found', 404);
  }
}

export class CartItemNotFoundError extends AppError {
  constructor() {
    super('CART_ITEM_NOT_FOUND', 'Item not found in the cart', 404);
  }
}

export interface StockShortage {
  productId: number;
  requested: number;
  available: number;
}

export class InsufficientStockError extends AppError {
  constructor(items: readonly StockShortage[]) {
    super('INSUFFICIENT_STOCK', 'Insufficient stock', 409, { items });
  }
}
