import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { carts } from '../../db/schema';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCart } from '../../test-support/factories';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { DrizzleUnitOfWork } from './cart.unit-of-work';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const TIMEOUT_MS = 10_000;
const START = new Date('2030-01-01T12:00:00Z');

let now = START;
const service = new CartService({
  carts: new CartRepository(db),
  unitOfWork: new DrizzleUnitOfWork(db),
  clock: () => now,
  inactivityTimeoutMs: TIMEOUT_MS,
});

afterEach(async () => {
  now = START;
  await cleanup.run(db);
});
afterAll(() => close());

async function readCart(id: number) {
  const [row] = await db.select().from(carts).where(eq(carts.id, id));
  return row;
}

describe('CartService create and view (integration)', () => {
  it('creates an empty cart stamped with the injected clock', async () => {
    const view = await service.createCart();
    cleanup.trackCart(view.id);

    expect(view.status).toBe('empty');
    expect((await readCart(view.id)).lastActivityAt).toEqual(START);
  });

  it('abandons an idle active cart on read and keeps last_activity_at (RN-020)', async () => {
    const cart = await createCart(db, cleanup, { status: 'with_items', lastActivityAt: START });
    now = new Date(START.getTime() + TIMEOUT_MS + 1);

    const view = await service.getCart(cart.id);

    expect(view.status).toBe('abandoned');
    const row = await readCart(cart.id);
    expect(row.status).toBe('abandoned');
    expect(row.lastActivityAt).toEqual(START);
  });

  it('does not abandon a cart idle exactly for the timeout, nor an empty one', async () => {
    const active = await createCart(db, cleanup, { status: 'in_checkout', lastActivityAt: START });
    const empty = await createCart(db, cleanup, { status: 'empty', lastActivityAt: START });
    now = new Date(START.getTime() + TIMEOUT_MS);
    expect((await service.getCart(active.id)).status).toBe('in_checkout');

    now = new Date(START.getTime() + TIMEOUT_MS * 100);
    expect((await service.getCart(empty.id)).status).toBe('empty');
  });

  it('throws CART_NOT_FOUND for an unknown id', async () => {
    await expect(service.getCart(2147483647)).rejects.toMatchObject({ code: 'CART_NOT_FOUND' });
  });
});
