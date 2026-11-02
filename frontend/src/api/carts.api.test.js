// @ts-check
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  abandonCart,
  addItem,
  applyCoupon,
  checkout,
  confirmCart,
  createCart,
  editCart,
  getCart,
  removeCoupon,
  removeItem,
  updateItemQuantity,
} from './carts.api.js';
import { installFakeFetch } from './fake-fetch.test-support.js';

/** @type {import('./fake-fetch.test-support.js').FakeFetch | undefined} */
let fake;
afterEach(() => fake?.restore());

/**
 * @param {() => Promise<unknown>} call
 * @param {string} method
 * @param {string} url
 * @param {string | undefined} body
 */
async function expectRequest(call, method, url, body) {
  fake = installFakeFetch({ body: { id: 7 } });
  await call();
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, url);
  assert.equal(fake.calls[0].init?.method, method);
  assert.equal(fake.calls[0].init?.body, body);
  assert.ok(!url.endsWith('.js'), 'no route may end in .js (nginx serves those from disk)');
  fake.restore();
}

test('createCart POSTs /api/carts', () =>
  expectRequest(() => createCart(), 'POST', '/api/carts', undefined));

test('getCart GETs the cart', () =>
  expectRequest(() => getCart(7), 'GET', '/api/carts/7', undefined));

test('addItem POSTs productId and quantity', () =>
  expectRequest(
    () => addItem(7, 3, 2),
    'POST',
    '/api/carts/7/items',
    '{"productId":3,"quantity":2}',
  ));

test('updateItemQuantity PATCHes the quantity', () =>
  expectRequest(
    () => updateItemQuantity(7, 3, 5),
    'PATCH',
    '/api/carts/7/items/3',
    '{"quantity":5}',
  ));

test('removeItem DELETEs the line', () =>
  expectRequest(() => removeItem(7, 3), 'DELETE', '/api/carts/7/items/3', undefined));

test('applyCoupon POSTs the code', () =>
  expectRequest(
    () => applyCoupon(7, 'DESC10'),
    'POST',
    '/api/carts/7/coupon',
    '{"code":"DESC10"}',
  ));

test('removeCoupon DELETEs the coupon', () =>
  expectRequest(() => removeCoupon(7), 'DELETE', '/api/carts/7/coupon', undefined));

test('checkout, editCart and abandonCart POST their actions', async () => {
  await expectRequest(() => checkout(7), 'POST', '/api/carts/7/checkout', undefined);
  await expectRequest(() => editCart(7), 'POST', '/api/carts/7/edit', undefined);
  await expectRequest(() => abandonCart(7), 'POST', '/api/carts/7/abandon', undefined);
});

test('confirmCart POSTs and returns order and cart', async () => {
  const payload = { order: { id: 1 }, cart: { id: 7 } };
  fake = installFakeFetch({ status: 201, body: payload });
  assert.deepEqual(await confirmCart(7), payload);
  assert.equal(fake.calls[0].url, '/api/carts/7/confirm');
  assert.equal(fake.calls[0].init?.method, 'POST');
});
