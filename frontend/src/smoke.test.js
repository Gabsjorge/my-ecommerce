// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPrice, isOutOfStock } from './domain/product.js';

test('formatPrice formats cents as BRL', () => {
  assert.match(formatPrice(1999), /19,99/);
});

test('isOutOfStock is true only for stock 0', () => {
  assert.equal(isOutOfStock({ stock: 0 }), true);
  assert.equal(isOutOfStock({ stock: 1 }), false);
});
