// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoute } from './route.js';

test('parseRoute maps the known hashes', () => {
  assert.equal(parseRoute('#/'), '/');
  assert.equal(parseRoute('#/cart'), '/cart');
});

test('parseRoute falls back to the product list', () => {
  assert.equal(parseRoute(''), '/');
  assert.equal(parseRoute('#'), '/');
  assert.equal(parseRoute('#/nope'), '/');
  assert.equal(parseRoute('#/cart/1'), '/');
});
