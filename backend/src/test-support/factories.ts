import { randomUUID } from 'node:crypto';
import type { Database } from '../db/client';
import {
  cartItems,
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
      name: `Cafeteira Italiana 6 Xícaras ${uniqueSuffix()}`,
      description: 'Cafeteira de alumínio para fogão, criada por um teste de integração',
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
      code: `PRIMEIRA-${uniqueSuffix()}`.toUpperCase(),
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

export interface CartLineInput {
  productId: number;
  quantity: number;
  unitPriceCents: number;
}

// Inserts a cart in any state with its lines already frozen; lines are removed with the cart (ON DELETE CASCADE).
export async function createCartWithItems(
  db: Database,
  cleanup: Cleanup,
  lines: CartLineInput[],
  overrides: Partial<NewCart> = {},
) {
  const cart = await createCart(db, cleanup, { status: 'with_items', ...overrides });
  if (lines.length > 0) {
    await db.insert(cartItems).values(lines.map((line) => ({ cartId: cart.id, ...line })));
  }
  return cart;
}
