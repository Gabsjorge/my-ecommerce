// @ts-check

const STORAGE_KEY = 'ecommerce.cartId';
const MAX_ID = 2147483647;

/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} CartStorage */

/**
 * @param {CartStorage} storage
 * @returns {number | null} The stored cart id, or null when absent or malformed.
 */
export function readCartId(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_ID ? id : null;
}

/**
 * @param {CartStorage} storage
 * @param {number} cartId
 */
export function saveCartId(storage, cartId) {
  storage.setItem(STORAGE_KEY, String(cartId));
}

/** @param {CartStorage} storage */
export function clearCartId(storage) {
  storage.removeItem(STORAGE_KEY);
}
