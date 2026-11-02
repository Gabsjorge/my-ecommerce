import { AppError } from '../../shared/errors';

export class ProductNotFoundError extends AppError {
  constructor() {
    super('PRODUCT_NOT_FOUND', 'Product not found', 404);
  }
}
