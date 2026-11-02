// @ts-check
import { formatPrice, isOutOfStock } from '../domain/product.js';
import { element } from './dom.js';

/** @typedef {import('../api/products.api.js').Product} Product */

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
 * @param {{ onAdd: (productId: number) => Promise<void> }} handlers
 */
export function renderProducts(root, products, { onAdd }) {
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

    const add = /** @type {HTMLButtonElement} */ (
      element('button', 'add-to-cart-button', 'Adicionar ao carrinho')
    );
    add.type = 'button';
    add.disabled = isOutOfStock(product);
    add.addEventListener('click', async () => {
      // Blocks double clicks while the request is in flight.
      add.disabled = true;
      try {
        await onAdd(product.id);
      } finally {
        add.disabled = isOutOfStock(product);
      }
    });
    item.append(add);

    list.append(item);
  }

  root.replaceChildren(list);
}
