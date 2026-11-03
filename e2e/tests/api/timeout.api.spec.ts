import { expect, test } from '@playwright/test';
import {
  addItem,
  cartInCheckout,
  cartWithItem,
  confirm,
  createCart,
  expectError,
  findProductByName,
  getCart,
  PRODUCT_NAMES,
} from '../../support/api';

// The test environment sets CART_INACTIVITY_TIMEOUT_SECONDS=10 (.env.test). These tests wait in real time,
// so they run in parallel with each other to overlap the waits.
const TIMEOUT_MS = 10_000;
const PAST_TIMEOUT_MS = TIMEOUT_MS + 1_500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('inactivity timeout (RN-020)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.setTimeout(40_000);

  test('an inactive with_items cart is read as abandoned and refuses writes', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    await sleep(PAST_TIMEOUT_MS);

    const read = await getCart(request, cart.id);
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('abandoned');

    expectError(
      await addItem(request, cart.id, { productId: product.id, quantity: 1 }),
      409,
      'INVALID_CART_STATE',
    );
    // The abandoned state was persisted, not rolled back with the refused write.
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });

  test('a write after the timeout is refused and the cart is then abandoned', async ({
    request,
  }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    await sleep(PAST_TIMEOUT_MS);

    // No read in between: the write itself detects the timeout.
    expectError(
      await addItem(request, cart.id, { productId: product.id, quantity: 1 }),
      409,
      'INVALID_CART_STATE',
    );
    const read = await getCart(request, cart.id);
    expect(read.body.status).toBe('abandoned');
    expect(read.body.items[0].quantity).toBe(1);
  });

  test('an inactive in_checkout cart cannot be confirmed and creates no order', async ({
    request,
  }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    await sleep(PAST_TIMEOUT_MS);

    expectError(await confirm(request, cart.id), 409, 'INVALID_CART_STATE');
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });

  test('reading does not renew the inactivity counter', async ({ request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    const writtenAt = Date.now();

    await sleep(6_000);
    expect((await getCart(request, cart.id)).body.status).toBe('with_items');

    await sleep(writtenAt + PAST_TIMEOUT_MS - Date.now());
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });

  test('a successful write restarts the inactivity counter', async ({ request }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    const firstWriteAt = Date.now();

    await sleep(6_000);
    const renewed = await addItem(request, cart.id, { productId: product.id, quantity: 1 });
    expect(renewed.status).toBe(200);

    // Past the timeout counted from the first write, but still inside it counted from the second.
    await sleep(firstWriteAt + PAST_TIMEOUT_MS - Date.now());
    const read = await getCart(request, cart.id);
    expect(read.body.status).toBe('with_items');
    expect(read.body.items[0].quantity).toBe(2);
  });

  test('a refused write does not restart the inactivity counter', async ({ request }) => {
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    const firstWriteAt = Date.now();

    await sleep(6_000);
    // Far above any stock the seed has, so it is refused whatever the other specs consumed.
    expectError(
      await addItem(request, cart.id, { productId: product.id, quantity: 1_000_000 }),
      409,
      'INSUFFICIENT_STOCK',
    );

    await sleep(firstWriteAt + PAST_TIMEOUT_MS - Date.now());
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });

  test('an empty cart never times out', async ({ request }) => {
    const cart = await createCart(request);
    const product = await findProductByName(request, PRODUCT_NAMES.highStock);
    await sleep(PAST_TIMEOUT_MS);

    expect((await getCart(request, cart.body.id)).body.status).toBe('empty');
    const res = await addItem(request, cart.body.id, { productId: product.id, quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('with_items');
  });
});
