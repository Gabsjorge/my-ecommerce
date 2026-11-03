// @ts-check
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { formatPrice } from '../domain/product.js';
import { installFakeDom } from './fake-dom.test-support.js';
import { renderCart } from './cart.view.js';

/** @typedef {import('../api/carts.api.js').CartView} CartView */

const NOTEBOOK = {
  productId: 7,
  name: 'Cafeteira Italiana 6 Xícaras',
  quantity: 2,
  unitPriceCents: 8990,
  subtotalCents: 17980,
};

/** @param {Partial<CartView>} [overrides] @returns {CartView} */
function cartView(overrides = {}) {
  return {
    id: 41,
    status: 'with_items',
    items: [NOTEBOOK],
    coupon: null,
    subtotalCents: 17980,
    discountCents: 0,
    totalCents: 17980,
    ...overrides,
  };
}

function makeHandlers() {
  return {
    onUpdateQuantity: mock.fn(),
    onRemoveItem: mock.fn(),
    onApplyCoupon: mock.fn(),
    onRemoveCoupon: mock.fn(),
    onCheckout: mock.fn(),
    onEdit: mock.fn(),
    onConfirm: mock.fn(),
    onAbandon: mock.fn(),
    onNewCart: mock.fn(),
  };
}

/** @type {ReturnType<typeof installFakeDom>} */
let dom;
/** @type {any} */
let root;
beforeEach(() => {
  dom = installFakeDom();
  root = dom.root;
});
afterEach(() => dom.restore());

/** Controls per state, from the "operações por estado" table of the FRD (UX mirror only). */
const CONTROLS_BY_STATE =
  /** @type {Record<string, { buttons: string[], couponForm: boolean, quantityDisabled: boolean }>} */ ({
    with_items: {
      buttons: ['checkout-button', 'abandon-button', 'cart-item-remove'],
      couponForm: true,
      quantityDisabled: false,
    },
    in_checkout: {
      buttons: ['edit-button', 'confirm-button', 'abandon-button'],
      couponForm: true,
      quantityDisabled: true,
    },
    order_created: { buttons: ['new-cart-button'], couponForm: false, quantityDisabled: true },
    abandoned: { buttons: ['new-cart-button'], couponForm: false, quantityDisabled: true },
  });

const ALL_BUTTONS = [
  'checkout-button',
  'edit-button',
  'confirm-button',
  'abandon-button',
  'new-cart-button',
  'cart-item-remove',
];

describe('renderCart: empty states', () => {
  it('shows the empty message and a link to the products when there is no cart (RF-013)', () => {
    renderCart(root, null, makeHandlers());

    assert.equal(root.find('cart-empty')?.textContent, 'Seu carrinho está vazio.');
    assert.equal(root.find('cart-empty-products-link')?.href, '#/');
    assert.equal(root.find('cart-status'), null);
  });

  it('shows the state label of an empty cart', () => {
    renderCart(root, cartView({ status: 'empty', items: [], totalCents: 0 }), makeHandlers());

    assert.equal(root.find('cart-status')?.textContent, 'Vazio');
    assert.ok(root.find('cart-empty'));
    assert.equal(root.find('checkout-button'), null);
  });
});

describe('renderCart: controls follow the state (RN-018, RN-024)', () => {
  for (const [status, expected] of Object.entries(CONTROLS_BY_STATE)) {
    it(`${status}: renders exactly the allowed controls`, () => {
      renderCart(root, cartView({ status: /** @type {any} */ (status) }), makeHandlers());

      for (const testId of ALL_BUTTONS) {
        const present = root.find(testId) !== null;
        assert.equal(present, expected.buttons.includes(testId), `${status} / ${testId}`);
      }
      assert.equal(root.find('coupon-input') !== null, expected.couponForm);
      assert.equal(root.find('coupon-apply') !== null, expected.couponForm);
      assert.equal(root.find('cart-item-quantity-input')?.disabled, expected.quantityDisabled);
    });
  }
});

describe('renderCart: content', () => {
  it('shows name, frozen unit price, quantity and line subtotal (RF-002, RN-004)', () => {
    renderCart(root, cartView(), makeHandlers());

    assert.equal(root.find('cart-item-name')?.textContent, NOTEBOOK.name);
    assert.equal(root.find('cart-item-unit-price')?.textContent, formatPrice(8990));
    assert.equal(root.find('cart-item-quantity-input')?.value, '2');
    assert.equal(root.find('cart-item-subtotal')?.textContent, formatPrice(17980));
  });

  it('shows subtotal, discount and total from the server values', () => {
    const cart = cartView({
      coupon: { code: 'DESC10', type: 'percentage', value: 10 },
      discountCents: 1798,
      totalCents: 16182,
    });
    renderCart(root, cart, makeHandlers());

    assert.equal(root.find('cart-subtotal')?.textContent, formatPrice(17980));
    assert.equal(root.find('cart-discount')?.textContent, formatPrice(1798));
    assert.equal(root.find('cart-total')?.textContent, formatPrice(16182));
  });

  it('shows the applied coupon with a remove button, and no apply form (RN-012)', () => {
    const cart = cartView({ coupon: { code: 'DESC10', type: 'percentage', value: 10 } });
    renderCart(root, cart, makeHandlers());

    assert.equal(root.find('coupon-code')?.textContent, 'DESC10');
    assert.ok(root.find('coupon-remove'));
    assert.equal(root.find('coupon-input'), null);
  });

  it('keeps the applied coupon read-only in a final state', () => {
    const cart = cartView({
      status: 'order_created',
      coupon: { code: 'DESC10', type: 'percentage', value: 10 },
    });
    renderCart(root, cart, makeHandlers());

    assert.equal(root.find('coupon-code')?.textContent, 'DESC10');
    assert.equal(root.find('coupon-remove'), null);
  });

  it('renders product names as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    renderCart(root, cartView({ items: [{ ...NOTEBOOK, name: hostile }] }), makeHandlers());

    const name = root.find('cart-item-name');
    assert.equal(name?.textContent, hostile);
    assert.equal(name?.children.length, 1);
    assert.equal(root.find('img'), null);
  });
});

describe('renderCart: handlers', () => {
  it('wires each button to its handler', () => {
    const handlers = makeHandlers();
    renderCart(root, cartView(), handlers);
    root.find('checkout-button')?.click();
    root.find('abandon-button')?.click();
    root.find('cart-item-remove')?.click();

    assert.equal(handlers.onCheckout.mock.callCount(), 1);
    assert.equal(handlers.onAbandon.mock.callCount(), 1);
    assert.deepEqual(handlers.onRemoveItem.mock.calls[0].arguments, [7]);

    renderCart(root, cartView({ status: 'in_checkout' }), handlers);
    root.find('edit-button')?.click();
    root.find('confirm-button')?.click();
    assert.equal(handlers.onEdit.mock.callCount(), 1);
    assert.equal(handlers.onConfirm.mock.callCount(), 1);

    renderCart(root, cartView({ status: 'abandoned' }), handlers);
    root.find('new-cart-button')?.click();
    assert.equal(handlers.onNewCart.mock.callCount(), 1);
  });

  it('passes the raw quantity text on change, leaving validation to the domain', () => {
    const handlers = makeHandlers();
    renderCart(root, cartView(), handlers);
    const input = root.find('cart-item-quantity-input');
    assert.ok(input);

    input.value = ' 3x ';
    input.dispatch('change');

    assert.deepEqual(handlers.onUpdateQuantity.mock.calls[0].arguments, [7, ' 3x ']);
  });

  it('submits the typed coupon code and prevents the native form submit', () => {
    const handlers = makeHandlers();
    renderCart(root, cartView(), handlers);
    const form = root.findAll('coupon-input')[0].parent;
    root.find('coupon-input').value = 'desc10';
    const preventDefault = mock.fn();

    form.dispatch('submit', { preventDefault });

    assert.equal(preventDefault.mock.callCount(), 1);
    assert.deepEqual(handlers.onApplyCoupon.mock.calls[0].arguments, ['desc10']);
  });

  it('removes the coupon through its button', () => {
    const handlers = makeHandlers();
    renderCart(
      root,
      cartView({ coupon: { code: 'FIXO20', type: 'fixed', value: 2000 } }),
      handlers,
    );

    root.find('coupon-remove')?.click();

    assert.equal(handlers.onRemoveCoupon.mock.callCount(), 1);
  });
});
