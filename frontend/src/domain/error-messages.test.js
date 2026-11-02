// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorMessage } from './error-messages.js';

const EXPECTED = {
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
  INTERNAL_ERROR: 'Algo deu errado. Tente novamente.',
  UNKNOWN_ERROR: 'Algo deu errado. Tente novamente.',
};

for (const [code, message] of Object.entries(EXPECTED)) {
  test(`errorMessage maps ${code}`, () => {
    assert.equal(errorMessage({ code }), message);
  });
}

test('errorMessage uses the generic message for unknown codes and non-errors', () => {
  const generic = 'Algo deu errado. Tente novamente.';
  assert.equal(errorMessage({ code: 'SOMETHING_NEW', message: 'leak' }), generic);
  assert.equal(errorMessage(new Error('boom')), generic);
  assert.equal(errorMessage(null), generic);
  assert.equal(errorMessage(undefined), generic);
});

test('INSUFFICIENT_STOCK lists each problematic item, resolving names from the cart', () => {
  const error = {
    code: 'INSUFFICIENT_STOCK',
    details: {
      items: [
        { productId: 1, requested: 3, available: 1 },
        { productId: 2, requested: 5, available: 0 },
        { productId: 9, requested: 2, available: 1 },
      ],
    },
  };
  const cart = {
    items: [
      { productId: 1, name: 'Caneta' },
      { productId: 2, name: 'Caderno' },
    ],
  };
  assert.equal(
    errorMessage(error, cart),
    [
      'Estoque insuficiente.',
      'Caneta: pedido 3, disponível 1',
      'Caderno: pedido 5, disponível 0',
      'Produto #9: pedido 2, disponível 1',
    ].join('\n'),
  );
});

test('INSUFFICIENT_STOCK without usable details is just the base message', () => {
  assert.equal(errorMessage({ code: 'INSUFFICIENT_STOCK' }), 'Estoque insuficiente.');
  assert.equal(
    errorMessage({ code: 'INSUFFICIENT_STOCK', details: { items: 'x' } }),
    'Estoque insuficiente.',
  );
});
