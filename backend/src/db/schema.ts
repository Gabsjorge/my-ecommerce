import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';

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

export type NewProduct = typeof products.$inferInsert;
