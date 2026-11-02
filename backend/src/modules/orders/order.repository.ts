import type { Executor } from '../../db/client';
import { orderItems, orders } from '../../db/schema';
import type { NewOrderInput, Order, OrderItemInput, OrderRepositoryPort } from './order.types';

export class OrderRepository implements OrderRepositoryPort {
  constructor(private readonly db: Executor) {}

  async create(order: NewOrderInput, items: readonly OrderItemInput[]): Promise<Order> {
    const [row] = await this.db.insert(orders).values(order).returning();

    if (items.length > 0) {
      await this.db.insert(orderItems).values(items.map((item) => ({ orderId: row.id, ...item })));
    }

    return {
      id: row.id,
      cartId: row.cartId,
      status: row.status,
      subtotalCents: row.subtotalCents,
      discountCents: row.discountCents,
      totalCents: row.totalCents,
      couponId: row.couponId,
      items: items.map((item) => ({ ...item })),
      createdAt: row.createdAt,
    };
  }
}
