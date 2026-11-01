// @ts-check

const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * @param {number} cents Price in cents (integer).
 * @returns {string}
 */
export function formatPrice(cents) {
  return priceFormatter.format(cents / 100);
}

/**
 * @param {{ stock: number }} product
 * @returns {boolean}
 */
export function isOutOfStock(product) {
  return product.stock === 0;
}
