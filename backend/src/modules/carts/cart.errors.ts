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
