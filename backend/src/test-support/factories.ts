import { randomUUID } from 'node:crypto';
import type { Database } from '../db/client';
import {
  carts,
  coupons,
  products,
  type NewCart,
  type NewCoupon,
  type NewProduct,
} from '../db/schema';
import type { Cleanup } from './cleanup';

function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

export async function createProduct(
  db: Database,
  cleanup: Cleanup,
  overrides: Partial<NewProduct> = {},
) {
  const [row] = await db
    .insert(products)
    .values({
      name: `Test product ${uniqueSuffix()}`,
      description: 'Created by an integration test',
      priceCents: 1000,
      stock: 10,
      ...overrides,
    })
    .returning();
  cleanup.trackProduct(row.id);
  return row;
}

export async function createCoupon(
  db: Database,
  cleanup: Cleanup,
  overrides: Partial<NewCoupon> = {},
) {
  const [row] = await db
    .insert(coupons)
    .values({
      code: `T-${uniqueSuffix()}`.toUpperCase(),
      type: 'percentage',
      value: 10,
      minOrderCents: 0,
      expiresAt: new Date('2099-12-31T23:59:59Z'),
      ...overrides,
    })
    .returning();
  cleanup.trackCoupon(row.id);
  return row;
}

export async function createCart(db: Database, cleanup: Cleanup, overrides: Partial<NewCart> = {}) {
  const [row] = await db
    .insert(carts)
    .values({ lastActivityAt: new Date(), ...overrides })
    .returning();
  cleanup.trackCart(row.id);
  return row;
}
