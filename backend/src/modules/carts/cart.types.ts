export const CART_STATUSES = [
  'empty',
  'with_items',
  'in_checkout',
  'order_created',
  'abandoned',
] as const;

export type CartStatus = (typeof CART_STATUSES)[number];

export type Clock = () => Date;

export interface CartRecord {
  id: number;
  status: CartStatus;
  couponId: number | null;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface CartItemRecord {
  productId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CartCouponRecord {
  id: number;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
}

// Everything needed to render a cart view, read without locking.
export interface CartDetails {
  cart: CartRecord;
  items: CartItemRecord[];
  coupon: CartCouponRecord | null;
}

export interface CartRepositoryPort {
  create(now: Date): Promise<CartRecord>;
  // Locks the cart row (FOR UPDATE); must run inside a transaction.
  lockById(id: number): Promise<CartRecord | null>;
  findDetails(id: number): Promise<CartDetails | null>;
  findItem(cartId: number, productId: number): Promise<CartItemRecord | null>;
  insertItem(
    cartId: number,
    productId: number,
    quantity: number,
    unitPriceCents: number,
  ): Promise<void>;
  updateQuantity(cartId: number, productId: number, quantity: number): Promise<void>;
  deleteItem(cartId: number, productId: number): Promise<void>;
  setStatus(cartId: number, status: CartStatus): Promise<void>;
  setCoupon(cartId: number, couponId: number | null): Promise<void>;
  // Registers a successful write (resets the inactivity counter, RN-020).
  touch(cartId: number, at: Date): Promise<void>;
  // Conditional and atomic; never changes last_activity_at. True when the cart was abandoned.
  abandonIfExpired(cartId: number, cutoff: Date): Promise<boolean>;
}

export interface CartItemView {
  productId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
}

export interface CartView {
  id: number;
  status: CartStatus;
  items: CartItemView[];
  coupon: { code: string; type: 'percentage' | 'fixed'; value: number } | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export interface OrderView {
  id: number;
  cartId: number;
  status: string;
  items: { productId: number; name: string; quantity: number; unitPriceCents: number }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponCode: string | null;
  createdAt: Date;
}

export interface ConfirmResult {
  order: OrderView;
  cart: CartView;
}
