// @ts-check
import { allowedActions, statusLabel } from '../domain/cart.js';
import { formatPrice } from '../domain/product.js';
import { button, element } from './dom.js';

/** @typedef {import('../api/carts.api.js').CartView} CartView */

/**
 * @typedef {Object} CartHandlers
 * @property {(productId: number, text: string) => void} onUpdateQuantity
 * @property {(productId: number) => void} onRemoveItem
 * @property {(code: string) => void} onApplyCoupon
 * @property {() => void} onRemoveCoupon
 * @property {() => void} onCheckout
 * @property {() => void} onEdit
 * @property {() => void} onConfirm
 * @property {() => void} onAbandon
 * @property {() => void} onNewCart
 */

/**
 * @param {string} testId
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
function summaryLine(testId, label, value) {
  const line = element('p', null);
  line.append(`${label}: `, element('span', testId, value));
  return line;
}

/**
 * @param {CartView['items'][number]} item
 * @param {boolean} editable
 * @param {CartHandlers} handlers
 * @returns {HTMLElement}
 */
function renderItem(item, editable, handlers) {
  const li = element('li', 'cart-item');
  li.className = 'cart-item';

  const input = /** @type {HTMLInputElement} */ (element('input', 'cart-item-quantity-input'));
  input.type = 'text';
  input.inputMode = 'numeric';
  input.value = String(item.quantity);
  input.setAttribute('aria-label', `Quantidade de ${item.name}`);
  input.disabled = !editable;
  input.addEventListener('change', () => handlers.onUpdateQuantity(item.productId, input.value));

  li.append(
    element('span', 'cart-item-name', item.name),
    element('span', 'cart-item-unit-price', formatPrice(item.unitPriceCents)),
    input,
    element('span', 'cart-item-subtotal', formatPrice(item.subtotalCents)),
  );
  if (editable) {
    li.append(button('cart-item-remove', 'Remover', () => handlers.onRemoveItem(item.productId)));
  }
  return li;
}

/**
 * @param {CartView} cart
 * @param {boolean} canEditCoupon
 * @param {CartHandlers} handlers
 * @returns {HTMLElement | null}
 */
function renderCoupon(cart, canEditCoupon, handlers) {
  if (cart.coupon) {
    const box = element('div', null);
    box.append(summaryLine('coupon-code', 'Cupom', cart.coupon.code));
    if (canEditCoupon)
      box.append(button('coupon-remove', 'Remover cupom', handlers.onRemoveCoupon));
    return box;
  }
  if (!canEditCoupon) return null;

  const form = /** @type {HTMLFormElement} */ (element('form', null));
  const input = /** @type {HTMLInputElement} */ (element('input', 'coupon-input'));
  input.type = 'text';
  input.placeholder = 'Código do cupom';
  input.setAttribute('aria-label', 'Código do cupom');
  const apply = /** @type {HTMLButtonElement} */ (
    element('button', 'coupon-apply', 'Aplicar cupom')
  );
  apply.type = 'submit';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onApplyCoupon(input.value);
  });
  form.append(input, apply);
  return form;
}

/**
 * @param {HTMLElement} root
 * @param {CartView | null} cart Null when the customer has no cart yet.
 * @param {CartHandlers} handlers
 */
export function renderCart(root, cart, handlers) {
  if (!cart || cart.items.length === 0) {
    const empty = element('div', null);
    empty.append(element('p', 'cart-empty', 'Seu carrinho está vazio.'));
    const link = /** @type {HTMLAnchorElement} */ (
      element('a', 'cart-empty-products-link', 'Ver produtos')
    );
    link.href = '#/';
    empty.append(link);
    if (cart) {
      empty.prepend(summaryLine('cart-status', 'Estado', statusLabel(cart.status)));
    }
    root.replaceChildren(empty);
    return;
  }

  const actions = allowedActions(cart.status);
  const section = element('section', null);

  const list = element('ul', null);
  list.className = 'cart-items';
  for (const item of cart.items) list.append(renderItem(item, actions.editItems, handlers));

  const controls = element('div', null);
  controls.className = 'cart-actions';
  if (actions.checkout)
    controls.append(button('checkout-button', 'Iniciar checkout', handlers.onCheckout));
  if (actions.edit) controls.append(button('edit-button', 'Voltar a editar', handlers.onEdit));
  if (actions.confirm)
    controls.append(button('confirm-button', 'Confirmar pedido', handlers.onConfirm));
  if (actions.abandon)
    controls.append(button('abandon-button', 'Abandonar carrinho', handlers.onAbandon));
  if (actions.newCart)
    controls.append(button('new-cart-button', 'Novo carrinho', handlers.onNewCart));

  section.append(
    summaryLine('cart-status', 'Estado', statusLabel(cart.status)),
    list,
    summaryLine('cart-subtotal', 'Subtotal', formatPrice(cart.subtotalCents)),
    summaryLine('cart-discount', 'Desconto', formatPrice(cart.discountCents)),
    summaryLine('cart-total', 'Total', formatPrice(cart.totalCents)),
    controls,
  );
  const coupon = renderCoupon(cart, actions.coupon, handlers);
  if (coupon) list.after(coupon);
  root.replaceChildren(section);
}
