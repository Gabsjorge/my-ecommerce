export interface NewOrderInput {
  cartId: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponId: number | null;
}

export interface OrderItemInput {
  productId: number;
  quantity: number;
  unitPriceCents: number;
}

export interface Order extends NewOrderInput {
  id: number;
  status: string;
  items: OrderItemInput[];
  createdAt: Date;
}

export interface OrderRepositoryPort {
  // Creation only: order lookup and lifecycle are out of scope for the cart feature.
  create(order: NewOrderInput, items: readonly OrderItemInput[]): Promise<Order>;
}
