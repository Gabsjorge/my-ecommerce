// @ts-check
import { element } from './dom.js';

/**
 * @param {HTMLElement} root
 * @param {{ count: number }} state Total units in the cart.
 */
export function renderHeader(root, { count }) {
  const nav = element('nav', null);

  const products = /** @type {HTMLAnchorElement} */ (element('a', 'products-link', 'Produtos'));
  products.href = '#/';

  const cart = /** @type {HTMLAnchorElement} */ (element('a', 'cart-link'));
  cart.href = '#/cart';
  cart.append('Carrinho (', element('span', 'cart-count', String(count)), ')');

  nav.append(products, cart);
  root.replaceChildren(nav);
}

/**
 * Error banner shared by the product list and the cart. Null clears it.
 * @param {HTMLElement} root
 * @param {string | null} message May contain several lines.
 */
export function renderNotice(root, message) {
  if (message === null) {
    root.replaceChildren();
    return;
  }
  const el = element('p', 'cart-error', message);
  el.setAttribute('role', 'alert');
  root.replaceChildren(el);
}
