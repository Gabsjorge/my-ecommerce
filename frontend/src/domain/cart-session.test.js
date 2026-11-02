// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearCartId, readCartId, saveCartId } from './cart-session.js';

/** @param {Record<string, string>} [initial] */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (/** @type {string} */ key) => data.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => void data.set(key, value),
    removeItem: (/** @type {string} */ key) => void data.delete(key),
  };
}

test('readCartId returns null for an empty storage', () => {
  assert.equal(readCartId(memoryStorage()), null);
});

test('saveCartId then readCartId round-trips under ecommerce.cartId', () => {
  const storage = memoryStorage();
  saveCartId(storage, 42);
  assert.equal(storage.data.get('ecommerce.cartId'), '42');
  assert.equal(readCartId(storage), 42);
});

for (const raw of ['abc', '-3', '0', '1.5', '', '2147483648']) {
  test(`readCartId ignores malformed value ${JSON.stringify(raw)}`, () => {
    assert.equal(readCartId(memoryStorage({ 'ecommerce.cartId': raw })), null);
  });
}

test('clearCartId removes the stored id', () => {
  const storage = memoryStorage({ 'ecommerce.cartId': '5' });
  clearCartId(storage);
  assert.equal(readCartId(storage), null);
});
