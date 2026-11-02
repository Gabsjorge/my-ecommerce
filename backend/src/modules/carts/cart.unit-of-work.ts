import type { Database } from '../../db/client';
import type { CouponRepositoryPort } from '../coupons/coupon.types';
import { CouponRepository } from '../coupons/coupon.repository';
import type { OrderRepositoryPort } from '../orders/order.types';
import { OrderRepository } from '../orders/order.repository';
import { ProductRepository } from '../products/product.repository';
import type { ProductRepositoryPort } from '../products/product.types';
import { CartRepository } from './cart.repository';
import type { CartRepositoryPort } from './cart.types';

// Repositories bound to one transaction: all of them commit or roll back together (RN-021).
export interface TxRepositories {
  carts: CartRepositoryPort;
  coupons: CouponRepositoryPort;
  products: ProductRepositoryPort;
  orders: OrderRepositoryPort;
}

export interface UnitOfWork {
  run<T>(work: (repositories: TxRepositories) => Promise<T>): Promise<T>;
}

// Opens a database transaction; any error thrown by `work` rolls everything back.
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (repositories: TxRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) =>
      work({
        carts: new CartRepository(tx),
        coupons: new CouponRepository(tx),
        products: new ProductRepository(tx),
        orders: new OrderRepository(tx),
      }),
    );
  }
}
