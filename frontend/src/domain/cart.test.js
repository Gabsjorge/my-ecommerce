// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedActions, isTerminal, itemCount, parseQuantity, statusLabel } from './cart.js';

/** @typedef {keyof ReturnType<typeof allowedActions>} Action */

// Same layout as the "operations by state" table (blueprint §5.2).
/** @type {Record<string, Record<Action, boolean>>} */
const TABLE = {
  empty: {
    addItem: true,
    editItems: false,
    coupon: false,
    checkout: false,
    edit: false,
    confirm: false,
    abandon: false,
    newCart: false,
  },
  with_items: {
    addItem: true,
    editItems: true,
    coupon: true,
    checkout: true,
    edit: false,
    confirm: false,
    abandon: true,
    newCart: false,
  },
  in_checkout: {
    addItem: false,
    editItems: false,
    coupon: true,
    checkout: false,
    edit: true,
    confirm: true,
    abandon: true,
    newCart: false,
  },
  order_created: {
    addItem: false,
    editItems: false,
    coupon: false,
    checkout: false,
    edit: false,
    confirm: false,
    abandon: false,
    newCart: true,
  },
  abandoned: {
    addItem: false,
    editItems: false,
    coupon: false,
    checkout: false,
    edit: false,
    confirm: false,
    abandon: false,
    newCart: true,
  },
};

for (const [status, expected] of Object.entries(TABLE)) {
  test(`allowedActions for ${status}`, () => {
    assert.deepEqual(allowedActions(/** @type {any} */ (status)), expected);
  });
}

test('statusLabel returns the pt-BR label of each state', () => {
  assert.equal(statusLabel('empty'), 'Vazio');
  assert.equal(statusLabel('with_items'), 'Com Itens');
  assert.equal(statusLabel('in_checkout'), 'Em Checkout');
  assert.equal(statusLabel('order_created'), 'Pedido Criado');
  assert.equal(statusLabel('abandoned'), 'Abandonado');
});

test('isTerminal is true only for final states', () => {
  assert.equal(isTerminal('order_created'), true);
  assert.equal(isTerminal('abandoned'), true);
  assert.equal(isTerminal('empty'), false);
  assert.equal(isTerminal('with_items'), false);
  assert.equal(isTerminal('in_checkout'), false);
});

test('itemCount sums quantities and is 0 without a cart', () => {
  assert.equal(itemCount(null), 0);
  assert.equal(itemCount({ items: [] }), 0);
  assert.equal(itemCount({ items: [{ quantity: 2 }, { quantity: 3 }] }), 5);
});

test('parseQuantity accepts positive integers', () => {
  assert.equal(parseQuantity('1'), 1);
  assert.equal(parseQuantity(' 12 '), 12);
  assert.equal(parseQuantity('007'), 7);
  assert.equal(parseQuantity('2147483647'), 2147483647);
});

for (const text of ['', '   ', '0', '-1', '1.5', '1,5', 'abc', '1e3', '2147483648']) {
  test(`parseQuantity rejects ${JSON.stringify(text)}`, () => {
    assert.equal(parseQuantity(text), null);
  });
}
