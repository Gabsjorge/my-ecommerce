// @ts-check
import { deleteJson, getJson, patchJson, postJson } from './http-client.js';

/**
 * @typedef {Object} CartItem
 * @property {number} productId
 * @property {string} name
 * @property {number} quantity
 * @property {number} unitPriceCents
 * @property {number} subtotalCents
 */

/**
 * @typedef {Object} CartCoupon
 * @property {string} code
 * @property {'percentage' | 'fixed'} type
 * @property {number} value
 */

/**
 * @typedef {'empty' | 'with_items' | 'in_checkout' | 'order_created' | 'abandoned'} CartStatus
 */

/**
 * @typedef {Object} CartView
 * @property {number} id
 * @property {CartStatus} status
 * @property {CartItem[]} items
 * @property {CartCoupon | null} coupon
 * @property {number} subtotalCents
 * @property {number} discountCents
 * @property {number} totalCents
 */

/**
 * @typedef {Object} OrderItem
 * @property {number} productId
 * @property {string} name
 * @property {number} quantity
 * @property {number} unitPriceCents
 */

/**
 * @typedef {Object} OrderView
 * @property {number} id
 * @property {number} cartId
 * @property {string} status
 * @property {OrderItem[]} items
 * @property {number} subtotalCents
 * @property {number} discountCents
 * @property {number} totalCents
 * @property {string | null} couponCode
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ConfirmResponse
 * @property {OrderView} order
 * @property {CartView} cart
 */

/** @param {number} cartId */
const cartPath = (cartId) => `/api/carts/${cartId}`;

/** @returns {Promise<CartView>} */
export async function createCart() {
  return /** @type {CartView} */ (await postJson('/api/carts'));
}

/** @param {number} cartId @returns {Promise<CartView>} */
export async function getCart(cartId) {
  return /** @type {CartView} */ (await getJson(cartPath(cartId)));
}

/**
 * @param {number} cartId
 * @param {number} productId
 * @param {number} quantity
 * @returns {Promise<CartView>}
 */
export async function addItem(cartId, productId, quantity) {
  return /** @type {CartView} */ (
    await postJson(`${cartPath(cartId)}/items`, { productId, quantity })
  );
}

/**
 * @param {number} cartId
 * @param {number} productId
 * @param {number} quantity
 * @returns {Promise<CartView>}
 */
export async function updateItemQuantity(cartId, productId, quantity) {
  return /** @type {CartView} */ (
    await patchJson(`${cartPath(cartId)}/items/${productId}`, { quantity })
  );
}

/**
 * @param {number} cartId
 * @param {number} productId
 * @returns {Promise<CartView>}
 */
export async function removeItem(cartId, productId) {
  return /** @type {CartView} */ (await deleteJson(`${cartPath(cartId)}/items/${productId}`));
}

/**
 * @param {number} cartId
 * @param {string} code
 * @returns {Promise<CartView>}
 */
export async function applyCoupon(cartId, code) {
  return /** @type {CartView} */ (await postJson(`${cartPath(cartId)}/coupon`, { code }));
}

/** @param {number} cartId @returns {Promise<CartView>} */
export async function removeCoupon(cartId) {
  return /** @type {CartView} */ (await deleteJson(`${cartPath(cartId)}/coupon`));
}

/** @param {number} cartId @returns {Promise<CartView>} */
export async function checkout(cartId) {
  return /** @type {CartView} */ (await postJson(`${cartPath(cartId)}/checkout`));
}

/** @param {number} cartId @returns {Promise<CartView>} */
export async function editCart(cartId) {
  return /** @type {CartView} */ (await postJson(`${cartPath(cartId)}/edit`));
}

/** @param {number} cartId @returns {Promise<CartView>} */
export async function abandonCart(cartId) {
  return /** @type {CartView} */ (await postJson(`${cartPath(cartId)}/abandon`));
}

/** @param {number} cartId @returns {Promise<ConfirmResponse>} */
export async function confirmCart(cartId) {
  return /** @type {ConfirmResponse} */ (await postJson(`${cartPath(cartId)}/confirm`));
}
