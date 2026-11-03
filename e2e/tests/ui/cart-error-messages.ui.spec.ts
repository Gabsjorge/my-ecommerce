import { expect, test, type Page } from '@playwright/test';
import {
  applyCoupon,
  cartInCheckout,
  cartWithItem,
  checkout,
  COUPON_CODES,
  getCart,
  PRODUCT_NAMES,
  updateItem,
} from '../../support/api';
import { addToCartFromList, brl, openWithCart } from '../../support/ui';

// RN-023: every API error code has a pt-BR message. Real triggers for some codes are unreachable from the UI
// (the UI hides the control), so the server answer is simulated for that one request with page.route.
// Each test builds its own cart and stays well inside the 10 s inactivity timeout.

const HIGH_STOCK_PRICE = 1000;

function errorBody(code: string, message: string) {
  return JSON.stringify({ error: { code, message } });
}

async function simulateError(
  page: Page,
  url: string,
  method: string,
  status: number,
  code: string,
) {
  await page.route(url, (route) => {
    if (route.request().method() !== method) return route.fallback();
    return route.fulfill({
      status,
      contentType: 'application/json',
      // The server message is in English on purpose: the UI must show its own pt-BR text.
      body: errorBody(code, `server message for ${code}`),
    });
  });
}

test.describe('pt-BR messages for API errors (RN-023)', () => {
  test('CART_ITEM_NOT_FOUND on a quantity change', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    await openWithCart(page, cart.id);
    await simulateError(page, '**/api/carts/*/items/*', 'PATCH', 404, 'CART_ITEM_NOT_FOUND');

    const input = page.getByTestId('cart-item-quantity-input');
    await input.fill('3');
    await input.blur();

    await expect(page.getByTestId('cart-error')).toHaveText('Item não encontrado no carrinho.');
  });

  test('COUPON_ALREADY_APPLIED when applying a coupon', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    await openWithCart(page, cart.id);
    await simulateError(page, '**/api/carts/*/coupon', 'POST', 409, 'COUPON_ALREADY_APPLIED');

    await page.getByTestId('coupon-input').fill(COUPON_CODES.percentage);
    await page.getByTestId('coupon-apply').click();

    await expect(page.getByTestId('cart-error')).toHaveText(
      'Já há um cupom aplicado. Remova-o para aplicar outro.',
    );
  });

  test('COUPON_NOT_APPLIED when removing a coupon', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage })).status).toBe(
      200,
    );
    await openWithCart(page, cart.id);
    await simulateError(page, '**/api/carts/*/coupon', 'DELETE', 409, 'COUPON_NOT_APPLIED');

    await page.getByTestId('coupon-remove').click();

    await expect(page.getByTestId('cart-error')).toHaveText('Não há cupom aplicado.');
  });

  test('PRODUCT_NOT_FOUND when adding from the list', async ({ page }) => {
    await page.goto('/');
    await simulateError(page, '**/api/carts/*/items', 'POST', 404, 'PRODUCT_NOT_FOUND');

    await addToCartFromList(page, PRODUCT_NAMES.regular);

    await expect(page.getByTestId('cart-error')).toHaveText('Produto não encontrado.');
  });

  test('INTERNAL_ERROR shows a generic message without internal details', async ({ page }) => {
    await page.goto('/');
    await simulateError(page, '**/api/carts/*/items', 'POST', 500, 'INTERNAL_ERROR');

    await addToCartFromList(page, PRODUCT_NAMES.regular);

    const error = page.getByTestId('cart-error');
    await expect(error).toHaveText('Algo deu errado. Tente novamente.');
    await expect(error).not.toContainText('server message');
  });

  test('an unknown error code falls back to the generic message', async ({ page }) => {
    await page.goto('/');
    await simulateError(page, '**/api/carts/*/items', 'POST', 418, 'TEAPOT');

    await addToCartFromList(page, PRODUCT_NAMES.regular);

    await expect(page.getByTestId('cart-error')).toHaveText('Algo deu errado. Tente novamente.');
  });

  test('NETWORK_ERROR when the server is unreachable', async ({ page }) => {
    await page.goto('/');
    await page.route('**/api/carts/*/items', (route) => route.abort('connectionrefused'));

    await addToCartFromList(page, PRODUCT_NAMES.regular);

    await expect(page.getByTestId('cart-error')).toHaveText(
      'Não foi possível conectar ao servidor.',
    );
  });
});

test.describe('line price and minimum order on confirmation', () => {
  test('shows the frozen unit price of each line (RF-002, RN-004)', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 3);
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('cart-item-unit-price')).toHaveText(brl(HIGH_STOCK_PRICE));
    await expect(page.getByTestId('cart-item-subtotal')).toHaveText(brl(3 * HIGH_STOCK_PRICE));
  });

  test('confirmation fails when the subtotal fell below the coupon minimum (RN-011, RN-016)', async ({
    page,
    request,
  }) => {
    // 21 x R$ 10,00 = R$ 210,00 satisfies MIN200 (R$ 200,00) when the coupon is applied.
    const { cart, product } = await cartWithItem(request, PRODUCT_NAMES.highStock, 21);
    expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.minOrder })).status).toBe(200);
    // Shrinking the cart keeps the coupon (RN-016); only the confirmation enforces the minimum.
    const shrunk = await updateItem(request, cart.id, product.id, { quantity: 5 });
    expect(shrunk.body.coupon?.code).toBe(COUPON_CODES.minOrder);
    expect((await checkout(request, cart.id)).status).toBe(200);
    await openWithCart(page, cart.id);

    // The discount shown is still computed on the current subtotal: 15% of R$ 50,00.
    await expect(page.getByTestId('cart-discount')).toHaveText(brl(750));
    await page.getByTestId('confirm-button').click();

    await expect(page.getByTestId('cart-error')).toHaveText(
      'O pedido não atinge o valor mínimo do cupom.',
    );
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await expect(page.getByTestId('order-summary')).toHaveCount(0);
    expect((await getCart(request, cart.id)).body.status).toBe('in_checkout');
  });

  test('applying MIN200 below the minimum shows the message and adds no coupon (RN-010)', async ({
    page,
    request,
  }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.minOrder })).status).toBe(422);
    await openWithCart(page, cart.id);

    await page.getByTestId('coupon-input').fill(COUPON_CODES.minOrder);
    await page.getByTestId('coupon-apply').click();

    await expect(page.getByTestId('cart-error')).toHaveText(
      'O pedido não atinge o valor mínimo do cupom.',
    );
    await expect(page.getByTestId('coupon-code')).toHaveCount(0);
  });
});
