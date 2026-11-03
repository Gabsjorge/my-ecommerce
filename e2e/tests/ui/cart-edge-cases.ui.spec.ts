import { expect, test } from '@playwright/test';
import {
  applyCoupon,
  cartInCheckout,
  cartWithItem,
  checkout,
  confirm,
  COUPON_CODES,
  expectError,
  getCart,
  PRODUCT_NAMES,
} from '../../support/api';
import { addToCartFromList, brl, openWithCart, storedCartId } from '../../support/ui';

// Every test builds its own cart. State is prepared through the API and the UI is used only for what is
// under test, so each flow stays well inside the 10 s inactivity timeout of the test environment.

const UNIT_PRICE = 1000;
const STATE_ERROR = 'Esta operação não está disponível para o estado atual do carrinho.';

test.describe('coupon while in checkout (RF-006, RF-007)', () => {
  test('applies and removes a coupon from the checkout screen', async ({ page, request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 10);
    await openWithCart(page, cart.id);
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');

    await page.getByTestId('coupon-input').fill(COUPON_CODES.percentage);
    await page.getByTestId('coupon-apply').click();
    await expect(page.getByTestId('coupon-code')).toHaveText(COUPON_CODES.percentage);
    await expect(page.getByTestId('cart-total')).toHaveText(brl(10 * UNIT_PRICE - 1000));
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');

    await page.getByTestId('coupon-remove').click();
    await expect(page.getByTestId('coupon-code')).toHaveCount(0);
    await expect(page.getByTestId('cart-total')).toHaveText(brl(10 * UNIT_PRICE));
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
  });
});

test.describe('abandoning from checkout (RF-010)', () => {
  test('abandons a cart in checkout and shows it read-only', async ({ page, request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    await openWithCart(page, cart.id);

    await page.getByTestId('abandon-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Abandonado');
    await expect(page.getByTestId('new-cart-button')).toBeVisible();
    await expect(page.getByTestId('confirm-button')).toHaveCount(0);
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });
});

test.describe('coupon consumed by another order (RN-011, RN-013)', () => {
  test('confirmation fails, then succeeds after removing the coupon', async ({ page, request }) => {
    const winner = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    const mine = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    for (const { cart } of [winner, mine]) {
      const applied = await applyCoupon(request, cart.id, { code: COUPON_CODES.uiDispute });
      expect(applied.status).toBe(200);
    }
    expect((await confirm(request, winner.cart.id)).status).toBe(201);
    await openWithCart(page, mine.cart.id);

    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('cart-error')).toHaveText('Este cupom já foi utilizado.');
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    expect((await getCart(request, mine.cart.id)).body.status).toBe('in_checkout');

    await page.getByTestId('coupon-remove').click();
    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    await expect(page.getByTestId('order-total')).toHaveText(brl(UNIT_PRICE));
  });
});

test.describe('errors when adding from the product list (RF-012, RN-023, RN-024)', () => {
  test('a cart in checkout refuses the add and the state is reloaded', async ({
    page,
    request,
  }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    await openWithCart(page, cart.id, '#/');
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await addToCartFromList(page, PRODUCT_NAMES.regular);
    await expect(page.getByTestId('cart-error')).toHaveText(STATE_ERROR);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    expect((await getCart(request, cart.id)).body.items).toHaveLength(1);
  });

  test('a final-state cart refuses the add', async ({ page, request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    expect((await confirm(request, cart.id)).status).toBe(201);
    await openWithCart(page, cart.id, '#/');

    await addToCartFromList(page, PRODUCT_NAMES.regular);
    await expect(page.getByTestId('cart-error')).toHaveText(STATE_ERROR);
    expect((await getCart(request, cart.id)).body.status).toBe('order_created');
  });

  test('adding beyond the stock shows the stock error and keeps the quantity', async ({
    page,
    request,
  }) => {
    // The limited-stock product has 3 units: the cart already holds all of them.
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.limitedStock, 3);
    await openWithCart(page, cart.id, '#/');

    await addToCartFromList(page, PRODUCT_NAMES.limitedStock);
    const error = page.getByTestId('cart-error');
    await expect(error).toContainText('Estoque insuficiente.');
    await expect(error).toContainText(`${PRODUCT_NAMES.limitedStock}: pedido 4, disponível 3`);
    await expect(page.getByTestId('cart-count')).toHaveText('3');
    expect((await getCart(request, cart.id)).body.items[0]?.quantity).toBe(3);
  });
});

test.describe('cart lost during the session (RF-015, RN-024)', () => {
  test('CART_NOT_FOUND on a write drops the stored id', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    await openWithCart(page, cart.id, '#/');
    expect(await storedCartId(page)).toBe(String(cart.id));

    // The API has no delete-cart operation, so the server answer is simulated for this one request.
    await page.route('**/api/carts/*/items', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'CART_NOT_FOUND', message: 'Cart not found' } }),
      }),
    );
    await addToCartFromList(page, PRODUCT_NAMES.regular);

    await expect(page.getByTestId('cart-error')).toHaveText('Carrinho não encontrado.');
    await expect(page.getByTestId('cart-count')).toHaveText('0');
    await expect.poll(() => storedCartId(page)).toBeNull();
  });
});

test.describe('inactivity timer and the UI (RN-020, RN-024)', () => {
  // The test environment sets CART_INACTIVITY_TIMEOUT_SECONDS=10 (.env.test); this test waits in real time.
  test.setTimeout(40_000);

  test('opening and reloading the cart does not renew the inactivity counter', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    await openWithCart(page, cart.id);
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');

    // Reload halfway through the timeout. If the UI renewed the counter on load, the write below
    // (11.5 s after the last real write) would still be accepted.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await page.reload();
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');
    await new Promise((resolve) => setTimeout(resolve, 5_500));

    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-error')).toHaveText(STATE_ERROR);
    await expect(page.getByTestId('cart-status')).toHaveText('Abandonado');
    expectError(await checkout(request, cart.id), 409, 'INVALID_CART_STATE');
  });
});
