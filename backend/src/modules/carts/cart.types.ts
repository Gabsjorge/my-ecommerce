export const CART_STATUSES = [
  'empty',
  'with_items',
  'in_checkout',
  'order_created',
  'abandoned',
] as const;

export type CartStatus = (typeof CART_STATUSES)[number];

export type Clock = () => Date;
