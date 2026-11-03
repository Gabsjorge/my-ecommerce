// @ts-check
import * as cartsApi from './api/carts.api.js';
import { fetchProducts } from './api/products.api.js';
import { itemCount, parseQuantity } from './domain/cart.js';
import { clearCartId, readCartId, saveCartId } from './domain/cart-session.js';
import { errorMessage } from './domain/error-messages.js';
import { parseRoute } from './domain/route.js';
import { renderHeader, renderNotice } from './views/app-header.view.js';
import { renderCart } from './views/cart.view.js';
import { renderOrderSummary } from './views/order-confirmation.view.js';
import {
  renderEmpty,
  renderError,
  renderLoading,
  renderProducts,
} from './views/product-list.view.js';

/** @typedef {import('./api/carts.api.js').CartView} CartView */
/** @typedef {import('./api/carts.api.js').OrderView} OrderView */

const headerEl = document.getElementById('header');
const titleEl = document.getElementById('page-title');
const noticeEl = document.getElementById('notice');
const appEl = document.getElementById('app');

/** @type {number | null} */
let cartId = null;
/** @type {CartView | null} */
let cart = null;
/** Order just confirmed in this page session; not restored on reload (RF-016). @type {OrderView | null} */
let lastOrder = null;
/** Discards the result of a stale async render when the route changes meanwhile. */
let renderToken = 0;
/** True while a cart write is pending; see runExclusive. */
let actionInFlight = false;

/** @param {string | null} message */
function showNotice(message) {
  if (noticeEl) renderNotice(noticeEl, message);
}

function renderHeaderView() {
  if (headerEl) renderHeader(headerEl, { count: itemCount(cart) });
}

/**
 * @param {unknown} err
 * @param {string} code
 */
function isApiCode(err, code) {
  return /** @type {{ code?: unknown }} */ (err)?.code === code;
}

function forgetCart() {
  cartId = null;
  cart = null;
  lastOrder = null;
  clearCartId(window.localStorage);
}

/** Loads the cart from the server. Reading never renews the inactivity timer (RN-020). */
async function refreshCart() {
  if (cartId === null) return;
  try {
    cart = await cartsApi.getCart(cartId);
  } catch (err) {
    if (isApiCode(err, 'CART_NOT_FOUND')) {
      forgetCart();
    } else {
      showNotice(errorMessage(err, cart));
    }
  }
}

function renderCartPage() {
  if (!appEl) return;
  renderCart(appEl, cart, {
    onUpdateQuantity: (productId, text) => void updateQuantity(productId, text),
    onRemoveItem: (productId) =>
      void runCartAction(() => cartsApi.removeItem(cartId ?? 0, productId)),
    onApplyCoupon: (code) => void runCartAction(() => cartsApi.applyCoupon(cartId ?? 0, code)),
    onRemoveCoupon: () => void runCartAction(() => cartsApi.removeCoupon(cartId ?? 0)),
    onCheckout: () => void runCartAction(() => cartsApi.checkout(cartId ?? 0)),
    onEdit: () => void runCartAction(() => cartsApi.editCart(cartId ?? 0)),
    onConfirm: () => void confirm(),
    onAbandon: () => void runCartAction(() => cartsApi.abandonCart(cartId ?? 0)),
    onNewCart: startNewCart,
  });
  if (lastOrder) renderOrderSummary(appEl, lastOrder);
}

/** @param {boolean} [silent] Skips the loading state (used when refreshing after an add). */
async function renderProductsPage(silent = false) {
  if (!appEl) return;
  const token = ++renderToken;
  if (!silent) renderLoading(appEl);
  try {
    const { data, total } = await fetchProducts();
    if (token !== renderToken) return;
    if (total === 0) renderEmpty(appEl);
    else renderProducts(appEl, data, { onAdd: addToCart });
  } catch {
    if (token === renderToken) renderError(appEl, 'Não foi possível carregar os produtos.');
  }
}

/** Renders whatever the current route shows, without refetching. */
function renderCurrent() {
  renderHeaderView();
  if (parseRoute(window.location.hash) === '/cart') renderCartPage();
}

async function renderRoute() {
  const route = parseRoute(window.location.hash);
  showNotice(null);
  if (titleEl) titleEl.textContent = route === '/cart' ? 'Carrinho' : 'Produtos';
  if (route === '/cart') {
    renderToken++;
    await refreshCart();
    renderCurrent();
  } else {
    renderHeaderView();
    await renderProductsPage();
  }
}

/**
 * Common error path. The server is the authority (RN-024): after a state error the
 * cart is reloaded to show the real state; the message stays visible.
 * @param {unknown} err
 */
async function handleError(err) {
  const message = errorMessage(err, cart);
  if (isApiCode(err, 'INVALID_CART_STATE')) {
    await refreshCart();
  } else if (isApiCode(err, 'CART_NOT_FOUND')) {
    forgetCart();
  }
  renderCurrent();
  showNotice(message);
}

/** @param {CartView} updated */
function applyCart(updated) {
  cart = updated;
  showNotice(null);
  renderCurrent();
}

/**
 * Runs one cart write at a time: a second click while a request is in flight is ignored,
 * so a double click cannot turn a success into an INVALID_CART_STATE notice (RF-014).
 * @param {() => Promise<void>} work
 */
async function runExclusive(work) {
  if (cartId === null || actionInFlight) return;
  actionInFlight = true;
  try {
    await work();
  } catch (err) {
    await handleError(err);
  } finally {
    actionInFlight = false;
  }
}

/** @param {() => Promise<CartView>} action */
function runCartAction(action) {
  return runExclusive(async () => applyCart(await action()));
}

/**
 * @param {number} productId
 * @param {string} text
 */
async function updateQuantity(productId, text) {
  const quantity = parseQuantity(text);
  if (quantity === null) {
    // Invalid input is never sent; re-render restores the previous value.
    renderCurrent();
    showNotice(errorMessage({ code: 'VALIDATION_ERROR' }));
    return;
  }
  await runCartAction(() => cartsApi.updateItemQuantity(cartId ?? 0, productId, quantity));
}

function confirm() {
  return runExclusive(async () => {
    const result = await cartsApi.confirmCart(cartId ?? 0);
    lastOrder = result.order;
    applyCart(result.cart);
  });
}

/**
 * Adds one unit from the product list, creating the cart on demand (RF-012).
 * @param {number} productId
 */
async function addToCart(productId) {
  try {
    if (cartId === null) {
      const created = await cartsApi.createCart();
      cartId = created.id;
      cart = created;
      saveCartId(window.localStorage, created.id);
    }
    cart = await cartsApi.addItem(cartId, productId, 1);
    showNotice(null);
    renderHeaderView();
    await renderProductsPage(true);
  } catch (err) {
    await handleError(err);
  }
}

function startNewCart() {
  forgetCart();
  showNotice(null);
  if (window.location.hash === '#/') {
    void renderRoute();
  } else {
    window.location.hash = '#/';
  }
}

async function main() {
  if (!appEl) return;
  cartId = readCartId(window.localStorage);
  await refreshCart();
  window.addEventListener('hashchange', () => void renderRoute());
  await renderRoute();
}

void main();
