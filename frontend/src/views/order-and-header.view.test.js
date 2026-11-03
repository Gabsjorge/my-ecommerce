// @ts-check
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { formatPrice } from '../domain/product.js';
import { renderHeader, renderNotice } from './app-header.view.js';
import { installFakeDom } from './fake-dom.test-support.js';
import { renderOrderSummary } from './order-confirmation.view.js';

/** @type {ReturnType<typeof installFakeDom>} */
let dom;
/** @type {any} */
let root;
beforeEach(() => {
  dom = installFakeDom();
  root = dom.root;
});
afterEach(() => dom.restore());

describe('renderOrderSummary (RF-016)', () => {
  const order = {
    id: 1203,
    cartId: 41,
    status: 'created',
    items: [
      { productId: 7, name: 'Cafeteira Italiana 6 Xícaras', quantity: 2, unitPriceCents: 8990 },
      { productId: 9, name: 'Garrafa Térmica 500ml', quantity: 1, unitPriceCents: 7990 },
    ],
    subtotalCents: 25970,
    discountCents: 2597,
    totalCents: 23373,
    couponCode: 'DESC10',
    createdAt: '2030-01-01T12:00:00.000Z',
  };

  it('shows number, one line per item, discount and total', () => {
    renderOrderSummary(root, /** @type {any} */ (order));

    assert.equal(root.find('order-id')?.textContent, '1203');
    const lines = root.findAll('order-item').map((/** @type {any} */ el) => el.textContent);
    assert.deepEqual(lines, [
      `Cafeteira Italiana 6 Xícaras — 2 × ${formatPrice(8990)}`,
      `Garrafa Térmica 500ml — 1 × ${formatPrice(7990)}`,
    ]);
    assert.equal(root.find('order-discount')?.textContent, formatPrice(2597));
    assert.equal(root.find('order-total')?.textContent, formatPrice(23373));
  });

  it('is prepended, keeping the content that was already in the container', () => {
    root.append('cart below');

    renderOrderSummary(root, /** @type {any} */ (order));

    assert.equal(root.children[0].dataset.testid, 'order-summary');
    assert.equal(root.children.length, 2);
  });
});

describe('renderHeader and renderNotice', () => {
  it('shows the cart link with the unit count', () => {
    renderHeader(root, { count: 3 });

    assert.equal(root.find('cart-count')?.textContent, '3');
    assert.equal(root.find('cart-link')?.href, '#/cart');
    assert.equal(root.find('products-link')?.href, '#/');
  });

  it('shows 0 for an empty cart', () => {
    renderHeader(root, { count: 0 });
    assert.equal(root.find('cart-count')?.textContent, '0');
  });

  it('renders a multi-line notice as an alert and clears it with null (RN-023)', () => {
    renderNotice(root, 'Estoque insuficiente.\nCafeteira: pedido 3, disponível 1');

    const notice = root.find('cart-error');
    assert.equal(notice?.textContent, 'Estoque insuficiente.\nCafeteira: pedido 3, disponível 1');
    assert.equal(notice?.attributes.role, 'alert');

    renderNotice(root, null);
    assert.equal(root.find('cart-error'), null);
  });
});
