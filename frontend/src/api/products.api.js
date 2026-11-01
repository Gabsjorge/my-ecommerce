// @ts-check
import { getJson } from './http-client.js';

/**
 * @typedef {Object} Product
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {number} priceCents
 * @property {number} stock
 */

/**
 * @typedef {Object} ProductListResponse
 * @property {Product[]} data
 * @property {number} total
 */

/** @returns {Promise<ProductListResponse>} */
export async function fetchProducts() {
  return /** @type {ProductListResponse} */ (await getJson('/api/products'));
}
