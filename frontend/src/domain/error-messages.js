// @ts-check

const GENERIC_MESSAGE = 'Algo deu errado. Tente novamente.';

/** @type {Record<string, string>} */
const MESSAGES = {
  VALIDATION_ERROR: 'Dados inválidos. Verifique o que foi informado.',
  CART_NOT_FOUND: 'Carrinho não encontrado.',
  PRODUCT_NOT_FOUND: 'Produto não encontrado.',
  CART_ITEM_NOT_FOUND: 'Item não encontrado no carrinho.',
  INVALID_CART_STATE: 'Esta operação não está disponível para o estado atual do carrinho.',
  INSUFFICIENT_STOCK: 'Estoque insuficiente.',
  COUPON_NOT_FOUND: 'Cupom não encontrado.',
  COUPON_EXPIRED: 'Cupom expirado.',
  COUPON_ALREADY_USED: 'Este cupom já foi utilizado.',
  COUPON_MIN_ORDER_NOT_MET: 'O pedido não atinge o valor mínimo do cupom.',
  COUPON_ALREADY_APPLIED: 'Já há um cupom aplicado. Remova-o para aplicar outro.',
  COUPON_NOT_APPLIED: 'Não há cupom aplicado.',
  NETWORK_ERROR: 'Não foi possível conectar ao servidor.',
};

/**
 * @param {unknown} details
 * @returns {{ productId: number, requested: number, available: number }[]}
 */
function stockItems(details) {
  const items = /** @type {{ items?: unknown } | null | undefined} */ (details)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item) =>
      item &&
      typeof item.productId === 'number' &&
      typeof item.requested === 'number' &&
      typeof item.available === 'number',
  );
}

/**
 * pt-BR message for an API error (RN-023). Unknown codes never leak internals.
 * @param {unknown} error
 * @param {{ items: { productId: number, name: string }[] } | null} [cart]
 *   Used to resolve product names in the stock detail.
 * @returns {string}
 */
export function errorMessage(error, cart = null) {
  const err = /** @type {{ code?: unknown, details?: unknown } | null | undefined} */ (error);
  const code = typeof err?.code === 'string' ? err.code : '';
  const base = MESSAGES[code] ?? GENERIC_MESSAGE;

  if (code !== 'INSUFFICIENT_STOCK') return base;

  const lines = stockItems(err?.details).map((item) => {
    const name = cart?.items.find((i) => i.productId === item.productId)?.name;
    return `${name ?? `Produto #${item.productId}`}: pedido ${item.requested}, disponível ${item.available}`;
  });
  return [base, ...lines].join('\n');
}
