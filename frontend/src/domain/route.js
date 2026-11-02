// @ts-check

/** @typedef {'/' | '/cart'} Route */

/**
 * @param {string} hash Value of `location.hash`.
 * @returns {Route} Unknown hashes fall back to the product list.
 */
export function parseRoute(hash) {
  return hash === '#/cart' ? '/cart' : '/';
}
