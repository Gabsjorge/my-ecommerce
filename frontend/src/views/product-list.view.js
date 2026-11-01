// @ts-check
import { formatPrice, isOutOfStock } from '../domain/product.js';

/** @typedef {import('../api/products.api.js').Product} Product */

/**
 * @param {string} tag
 * @param {string} testId
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function element(tag, testId, text) {
  const el = document.createElement(tag);
  el.dataset.testid = testId;
  // textContent only: never inject data through innerHTML.
  if (text !== undefined) el.textContent = text;
  return el;
}

/** @param {HTMLElement} root */
export function renderLoading(root) {
  root.replaceChildren(element('p', 'loading', 'Carregando produtos...'));
}

/** @param {HTMLElement} root */
export function renderEmpty(root) {
  root.replaceChildren(element('p', 'empty-state', 'Nenhum produto disponível.'));
}

/**
 * @param {HTMLElement} root
 * @param {string} message
 */
export function renderError(root, message) {
  root.replaceChildren(element('p', 'error-message', message));
}

/**
 * @param {HTMLElement} root
 * @param {Product[]} products
 */
export function renderProducts(root, products) {
  const list = element('ul', 'product-list');
  list.className = 'product-list';

  for (const product of products) {
    const item = element('li', 'product-item');
    item.className = 'product-item';

    item.append(
      element('h2', 'product-name', product.name),
      element('p', 'product-description', product.description),
      element('p', 'product-price', formatPrice(product.priceCents)),
      element('p', 'product-stock', `Estoque: ${product.stock}`),
    );

    if (isOutOfStock(product)) {
      const badge = element('span', 'out-of-stock-badge', 'Sem estoque');
      badge.className = 'badge';
      item.append(badge);
    }

    list.append(item);
  }

  root.replaceChildren(list);
}
