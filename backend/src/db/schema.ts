import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull(),
    priceCents: integer('price_cents').notNull(),
    stock: integer('stock').notNull(),
  },
  (t) => [
    check('products_price_cents_nonneg', sql`${t.priceCents} >= 0`),
    check('products_stock_nonneg', sql`${t.stock} >= 0`),
  ],
);

export const coupons = pgTable(
  'coupons',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // Stored normalized (upper case).
    code: varchar('code', { length: 30 }).notNull(),
    type: varchar('type', { length: 10 }).notNull(),
    value: integer('value').notNull(),
    minOrderCents: integer('min_order_cents').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    unique('coupons_code_unique').on(t.code),
    check('coupons_type_valid', sql`${t.type} IN ('percentage', 'fixed')`),
    check(
      'coupons_value_range',
      sql`(${t.type} = 'percentage' AND ${t.value} BETWEEN 1 AND 100) OR (${t.type} = 'fixed' AND ${t.value} > 0)`,
    ),
    check('coupons_min_order_cents_nonneg', sql`${t.minOrderCents} >= 0`),
  ],
);

export const carts = pgTable(
  'carts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    status: varchar('status', { length: 20 }).notNull().default('empty'),
    couponId: integer('coupon_id').references(() => coupons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Written with the injectable Clock (not the database now()) so the timeout is testable.
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'carts_status_valid',
      sql`${t.status} IN ('empty', 'with_items', 'in_checkout', 'order_created', 'abandoned')`,
    ),
    index('carts_status_idx').on(t.status),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    cartId: integer('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (t) => [
    unique('cart_items_cart_id_product_id_unique').on(t.cartId, t.productId),
    check('cart_items_quantity_min', sql`${t.quantity} >= 1`),
    check('cart_items_unit_price_cents_nonneg', sql`${t.unitPriceCents} >= 0`),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    cartId: integer('cart_id')
      .notNull()
      .references(() => carts.id),
    status: varchar('status', { length: 20 }).notNull().default('created'),
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    couponId: integer('coupon_id').references(() => coupons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('orders_cart_id_unique').on(t.cartId),
    // One order per coupon (single use guaranteed by the database). NULLs are allowed repeatedly.
    unique('orders_coupon_id_unique').on(t.couponId),
    // Order lifecycle is another feature; widen this check then.
    check('orders_status_valid', sql`${t.status} = 'created'`),
    check('orders_subtotal_cents_nonneg', sql`${t.subtotalCents} >= 0`),
    check('orders_discount_cents_nonneg', sql`${t.discountCents} >= 0`),
    check('orders_total_cents_nonneg', sql`${t.totalCents} >= 0`),
    check(
      'orders_total_consistent',
      sql`${t.totalCents} = ${t.subtotalCents} - ${t.discountCents}`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (t) => [
    check('order_items_quantity_min', sql`${t.quantity} >= 1`),
    check('order_items_unit_price_cents_nonneg', sql`${t.unitPriceCents} >= 0`),
  ],
);

export type NewProduct = typeof products.$inferInsert;
export type NewCoupon = typeof coupons.$inferInsert;
export type NewCart = typeof carts.$inferInsert;
export type NewCartItem = typeof cartItems.$inferInsert;
export type NewOrder = typeof orders.$inferInsert;
export type NewOrderItem = typeof orderItems.$inferInsert;
