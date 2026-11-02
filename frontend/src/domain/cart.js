// @ts-check

/** @typedef {import('../api/carts.api.js').CartStatus} CartStatus */

/** @type {Record<CartStatus, string>} */
const STATUS_LABELS = {
  empty: 'Vazio',
  with_items: 'Com Itens',
  in_checkout: 'Em Checkout',
  order_created: 'Pedido Criado',
  abandoned: 'Abandonado',
};

const MAX_QUANTITY = 2147483647;

/**
 * @typedef {Object} AllowedActions
 * @property {boolean} addItem
 * @property {boolean} editItems Update quantity and remove item.
 * @property {boolean} coupon Apply and remove coupon.
 * @property {boolean} checkout
 * @property {boolean} edit Back to editing.
 * @property {boolean} confirm
 * @property {boolean} abandon
 * @property {boolean} newCart
 */

/**
 * @param {CartStatus} status
 * @returns {string}
 */
export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

/**
 * @param {CartStatus} status
 * @returns {boolean}
 */
export function isTerminal(status) {
  return status === 'order_created' || status === 'abandoned';
}

/**
 * Mirrors the operations-by-state table. UX only: the server is the authority.
 * @param {CartStatus} status
 * @returns {AllowedActions}
 */
export function allowedActions(status) {
  return {
    addItem: status === 'empty' || status === 'with_items',
    editItems: status === 'with_items',
    coupon: status === 'with_items' || status === 'in_checkout',
    checkout: status === 'with_items',
    edit: status === 'in_checkout',
    confirm: status === 'in_checkout',
    abandon: status === 'with_items' || status === 'in_checkout',
    newCart: isTerminal(status),
  };
}

/**
 * Total units in the cart, shown in the header.
 * @param {{ items: { quantity: number }[] } | null} cart
 * @returns {number}
 */
export function itemCount(cart) {
  if (!cart) return 0;
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * @param {string} text Raw text typed by the user.
 * @returns {number | null} The quantity, or null when it must not be sent.
 */
export function parseQuantity(text) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_QUANTITY ? value : null;
}
