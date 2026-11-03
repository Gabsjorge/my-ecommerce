import { expect, test } from '@playwright/test';
import {
  addItem,
  applyCoupon,
  cartInCheckout,
  cartWithItem,
  checkout,
  findProductByName,
  getCart,
  getStock,
  PRODUCT_NAMES,
  COUPON_CODES,
} from '../../support/api';
import {
  addToCartFromList,
  brl,
  openCart,
  openWithCart,
  productCard,
  storedCartId,
} from '../../support/ui';

// Customer journeys driven through the interface, from the product list to the created order. Each flow is
// one sequential test; the API is used only to prepare state the UI cannot reach and to cross-check the
// server afterwards (persistence). Products "Kit Fluxo ... (E2E UI)" are used by this file only, so their
// stock is asserted exactly (tests of one file run serially). Every UI step stays inside the 10 s inactivity
// timeout of the test environment, except flow U5 on purpose.

const ALFA_PRICE = 4000;
const BETA_PRICE = 6000;
const PAST_TIMEOUT_MS = 11_500;

const stockLabel = (stock: number): string => `Estoque: ${stock}`;

test.describe('cart-to-order flows (UI)', () => {
  test('U1: full purchase from the product list to the created order', async ({
    page,
    request,
  }) => {
    const alfaBefore = await getStock(request, PRODUCT_NAMES.uiFlowAlfa);
    const betaBefore = await getStock(request, PRODUCT_NAMES.uiFlowBeta);

    await page.goto('/');
    await expect(page.getByTestId('cart-count')).toHaveText('0');
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowAlfa);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowBeta);
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowAlfa);
    await expect(page.getByTestId('cart-count')).toHaveText('3');
    const cartId = await storedCartId(page);
    expect(cartId).not.toBeNull();

    await openCart(page);
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');
    await expect(page.getByTestId('cart-item')).toHaveCount(2);

    const alfaLine = page.getByTestId('cart-item').filter({ hasText: PRODUCT_NAMES.uiFlowAlfa });
    await expect(alfaLine.getByTestId('cart-item-quantity-input')).toHaveValue('2');
    await alfaLine.getByTestId('cart-item-quantity-input').fill('3');
    await alfaLine.getByTestId('cart-item-quantity-input').blur();
    await expect(page.getByTestId('cart-subtotal')).toHaveText(brl(3 * ALFA_PRICE + BETA_PRICE));

    await page
      .getByTestId('cart-item')
      .filter({ hasText: PRODUCT_NAMES.uiFlowBeta })
      .getByTestId('cart-item-remove')
      .click();
    await expect(page.getByTestId('cart-item')).toHaveCount(1);
    await expect(page.getByTestId('cart-subtotal')).toHaveText(brl(3 * ALFA_PRICE));

    await page.getByTestId('coupon-input').fill(COUPON_CODES.uiFlowPurchase);
    await page.getByTestId('coupon-apply').click();
    await expect(page.getByTestId('coupon-code')).toHaveText(COUPON_CODES.uiFlowPurchase);
    await expect(page.getByTestId('cart-discount')).toHaveText(brl(1200));
    await expect(page.getByTestId('cart-total')).toHaveText(brl(10800));

    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    // Starting checkout does not reserve stock (RN-007)
    expect(await getStock(request, PRODUCT_NAMES.uiFlowAlfa)).toBe(alfaBefore);
    await page.getByTestId('confirm-button').click();

    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    const summary = page.getByTestId('order-summary');
    await expect(summary.getByTestId('order-id')).toHaveText(/^\d+$/);
    await expect(summary.getByTestId('order-item')).toHaveCount(1);
    await expect(summary.getByTestId('order-item')).toContainText(PRODUCT_NAMES.uiFlowAlfa);
    await expect(summary.getByTestId('order-discount')).toHaveText(brl(1200));
    await expect(summary.getByTestId('order-total')).toHaveText(brl(10800));

    // Persistence: the server agrees with the screen, and the list shows the lowered stock
    const server = await getCart(request, cartId ?? '');
    expect(server.body).toMatchObject({ status: 'order_created', totalCents: 10800 });
    expect(server.body.coupon?.code).toBe(COUPON_CODES.uiFlowPurchase);
    await page.getByTestId('products-link').click();
    await expect(
      productCard(page, PRODUCT_NAMES.uiFlowAlfa).getByTestId('product-stock'),
    ).toHaveText(stockLabel(alfaBefore - 3));
    await expect(
      productCard(page, PRODUCT_NAMES.uiFlowBeta).getByTestId('product-stock'),
    ).toHaveText(stockLabel(betaBefore));

    // After a reload the detailed summary is gone, but the final cart and its total remain (RF-016)
    await page.reload();
    await openCart(page);
    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    await expect(page.getByTestId('cart-total')).toHaveText(brl(10800));
    await expect(page.getByTestId('order-summary')).toHaveCount(0);
  });

  test('U2: back to editing, then abandon and start a new cart', async ({ page, request }) => {
    const alfaBefore = await getStock(request, PRODUCT_NAMES.uiFlowAlfa);

    await page.goto('/');
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowAlfa);
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowAlfa);
    await expect(page.getByTestId('cart-count')).toHaveText('2');
    const oldId = await storedCartId(page);
    await openCart(page);

    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await expect(page.getByTestId('cart-item-quantity-input')).toBeDisabled();

    await page.getByTestId('edit-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');
    const input = page.getByTestId('cart-item-quantity-input');
    await input.fill('1');
    await input.blur();
    await expect(page.getByTestId('cart-total')).toHaveText(brl(ALFA_PRICE));

    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await page.getByTestId('abandon-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Abandonado');
    await expect(page.getByTestId('new-cart-button')).toBeVisible();
    await expect(page.getByTestId('confirm-button')).toHaveCount(0);

    const old = await getCart(request, oldId ?? '');
    expect(old.body).toMatchObject({ status: 'abandoned' });
    expect(old.body.items[0]?.quantity).toBe(1);
    expect(await getStock(request, PRODUCT_NAMES.uiFlowAlfa)).toBe(alfaBefore);

    await page.getByTestId('new-cart-button').click();
    await expect.poll(() => storedCartId(page)).toBeNull();
    await expect(page.getByTestId('cart-count')).toHaveText('0');
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowBeta);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    const newId = await storedCartId(page);
    expect(newId).not.toBe(oldId);
    const fresh = await getCart(request, newId ?? '');
    expect(fresh.body.status).toBe('with_items');
    expect(fresh.body.items.map((i) => i.name)).toEqual([PRODUCT_NAMES.uiFlowBeta]);
  });

  test('U3: another customer takes the last unit, then the confirmation is recovered', async ({
    page,
    request,
  }) => {
    const last = await findProductByName(request, PRODUCT_NAMES.uiFlowLast);
    expect(last.stock).toBe(1);

    // Customer A holds the last unit with a coupon; customer B holds it too, plus another product
    const a = await cartInCheckout(request, PRODUCT_NAMES.uiFlowLast, 1);
    expect((await applyCoupon(request, a.cart.id, { code: COUPON_CODES.uiFlowStock })).status).toBe(
      200,
    );
    const b = await cartWithItem(request, PRODUCT_NAMES.uiFlowAlfa, 2);
    expect((await addItem(request, b.cart.id, { productId: last.id, quantity: 1 })).status).toBe(
      200,
    );
    expect((await checkout(request, b.cart.id)).status).toBe(200);
    const alfaBefore = await getStock(request, PRODUCT_NAMES.uiFlowAlfa);

    // A confirms through the UI and takes the last unit
    await openWithCart(page, a.cart.id);
    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    expect(await getStock(request, PRODUCT_NAMES.uiFlowLast)).toBe(0);

    // B's confirmation fails with the item listed in pt-BR and nothing changes
    await openWithCart(page, b.cart.id);
    await page.getByTestId('confirm-button').click();
    const error = page.getByTestId('cart-error');
    await expect(error).toContainText('Estoque insuficiente.');
    await expect(error).toContainText(`${PRODUCT_NAMES.uiFlowLast}: pedido 1, disponível 0`);
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await expect(page.getByTestId('order-summary')).toHaveCount(0);
    expect((await getCart(request, b.cart.id)).body.status).toBe('in_checkout');
    expect(await getStock(request, PRODUCT_NAMES.uiFlowAlfa)).toBe(alfaBefore);

    // Recovery: edit, remove the sold-out line, checkout again and confirm
    await page.getByTestId('edit-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');
    await page
      .getByTestId('cart-item')
      .filter({ hasText: PRODUCT_NAMES.uiFlowLast })
      .getByTestId('cart-item-remove')
      .click();
    await expect(page.getByTestId('cart-item')).toHaveCount(1);
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('confirm-button').click();

    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    const summary = page.getByTestId('order-summary');
    await expect(summary.getByTestId('order-item')).toHaveCount(1);
    await expect(summary.getByTestId('order-item')).toContainText(PRODUCT_NAMES.uiFlowAlfa);
    await expect(summary.getByTestId('order-total')).toHaveText(brl(2 * ALFA_PRICE));
    expect((await getCart(request, b.cart.id)).body.status).toBe('order_created');
    expect(await getStock(request, PRODUCT_NAMES.uiFlowAlfa)).toBe(alfaBefore - 2);
  });

  test('U4: the checkout survives a reload and is confirmed afterwards', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.uiFlowBeta, 2);
    const betaBefore = await getStock(request, PRODUCT_NAMES.uiFlowBeta);
    await openWithCart(page, cart.id);

    await page.getByTestId('coupon-input').fill(COUPON_CODES.uiFlowReload);
    await page.getByTestId('coupon-apply').click();
    await expect(page.getByTestId('cart-total')).toHaveText(brl(2 * BETA_PRICE - 1200));
    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');

    // Same browser, new page load: the cart is restored from the stored id (RF-015)
    await page.reload();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await expect(page.getByTestId('coupon-code')).toHaveText(COUPON_CODES.uiFlowReload);
    await expect(page.getByTestId('cart-total')).toHaveText(brl(2 * BETA_PRICE - 1200));

    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    await expect(page.getByTestId('order-discount')).toHaveText(brl(1200));
    await expect(page.getByTestId('order-total')).toHaveText(brl(2 * BETA_PRICE - 1200));

    expect((await getCart(request, cart.id)).body).toMatchObject({
      status: 'order_created',
      totalCents: 2 * BETA_PRICE - 1200,
    });
    expect(await getStock(request, PRODUCT_NAMES.uiFlowBeta)).toBe(betaBefore - 2);
  });

  test('U5: inactivity during checkout shows the real state and allows a new purchase', async ({
    page,
    request,
  }) => {
    test.setTimeout(40_000);
    const alfaBefore = await getStock(request, PRODUCT_NAMES.uiFlowAlfa);

    await page.goto('/');
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowAlfa);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    const oldId = await storedCartId(page);
    await openCart(page);
    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');

    // The timeout runs on the server clock; there is no UI signal to wait for.
    await new Promise((resolve) => setTimeout(resolve, PAST_TIMEOUT_MS));

    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('cart-error')).toHaveText(
      'Esta operação não está disponível para o estado atual do carrinho.',
    );
    await expect(page.getByTestId('cart-status')).toHaveText('Abandonado');
    await expect(page.getByTestId('order-summary')).toHaveCount(0);
    expect((await getCart(request, oldId ?? '')).body.status).toBe('abandoned');
    expect(await getStock(request, PRODUCT_NAMES.uiFlowAlfa)).toBe(alfaBefore);

    await page.getByTestId('new-cart-button').click();
    await expect.poll(() => storedCartId(page)).toBeNull();
    await addToCartFromList(page, PRODUCT_NAMES.uiFlowBeta);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    const newId = await storedCartId(page);
    expect(newId).not.toBe(oldId);
    expect((await getCart(request, newId ?? '')).body.status).toBe('with_items');
  });
});
