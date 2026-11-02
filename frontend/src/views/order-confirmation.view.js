// @ts-check
import { formatPrice } from '../domain/product.js';
import { element } from './dom.js';

/** @typedef {import('../api/carts.api.js').OrderView} OrderView */

/**
 * Summary of the order just created. Prepends to the container's content.
 * @param {HTMLElement} root
 * @param {OrderView} order
 */
export function renderOrderSummary(root, order) {
  const section = element('section', 'order-summary');
  section.className = 'order-summary';

  const title = element('h2', null);
  title.append('Pedido nº ', element('span', 'order-id', String(order.id)), ' criado');

  const list = element('ul', null);
  for (const item of order.items) {
    list.append(
      element(
        'li',
        'order-item',
        `${item.name} — ${item.quantity} × ${formatPrice(item.unitPriceCents)}`,
      ),
    );
  }

  const discount = element('p', null);
  discount.append(
    'Desconto: ',
    element('span', 'order-discount', formatPrice(order.discountCents)),
  );
  const total = element('p', null);
  total.append('Total: ', element('span', 'order-total', formatPrice(order.totalCents)));

  section.append(title, list, discount, total);
  root.prepend(section);
}
