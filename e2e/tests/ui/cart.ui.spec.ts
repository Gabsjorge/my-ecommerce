import { expect, test } from '@playwright/test';
import {
  abandon,
  cartInCheckout,
  cartWithItem,
  confirm,
  findProductByName,
  getCart,
  getStock,
  PRODUCT_NAMES,
} from '../../support/api';
import {
  addToCartFromList,
  brl,
  openCart,
  openWithCart,
  productCard,
  storedCartId,
} from '../../support/ui';

// Every test builds its own cart. State is prepared through the API and the UI is used only for what is
// under test, so each flow stays well inside the 10 s inactivity timeout of the test environment.

const HIGH_STOCK_PRICE = 1000;

test.describe('add to cart from the product list (RF-012)', () => {
  test('creates the cart on the first add and sums repeated adds', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('cart-count')).toHaveText('0');
    expect(await storedCartId(page)).toBeNull();

    await addToCartFromList(page, PRODUCT_NAMES.highStock);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    const cartId = await storedCartId(page);
    expect(cartId).not.toBeNull();

    await addToCartFromList(page, PRODUCT_NAMES.highStock);
    await expect(page.getByTestId('cart-count')).toHaveText('2');
    expect(await storedCartId(page)).toBe(cartId);

    await openCart(page);
    await expect(page.getByTestId('cart-item')).toHaveCount(1);
    await expect(page.getByTestId('cart-item-quantity-input')).toHaveValue('2');
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');

    const server = await getCart(request, cartId ?? '');
    expect(server.status).toBe(200);
    expect(server.body.items).toHaveLength(1);
    expect(server.body.items[0]?.quantity).toBe(2);
  });

  test('disables the add button for a product without stock', async ({ page }) => {
    await page.goto('/');
    const card = productCard(page, PRODUCT_NAMES.outOfStock);
    await expect(card.getByTestId('add-to-cart-button')).toBeDisabled();
    await expect(
      productCard(page, PRODUCT_NAMES.regular).getByTestId('add-to-cart-button'),
    ).toBeEnabled();
  });
});

test.describe('cart screen items (RF-013)', () => {
  test('updates the quantity and recalculates the totals', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    await openWithCart(page, cart.id);

    const input = page.getByTestId('cart-item-quantity-input');
    await expect(input).toHaveValue('2');
    await input.fill('5');
    await input.blur();

    await expect(page.getByTestId('cart-item-subtotal')).toHaveText(brl(5 * HIGH_STOCK_PRICE));
    await expect(page.getByTestId('cart-subtotal')).toHaveText(brl(5 * HIGH_STOCK_PRICE));
    await expect(page.getByTestId('cart-total')).toHaveText(brl(5 * HIGH_STOCK_PRICE));
    await expect(page.getByTestId('cart-count')).toHaveText('5');
  });

  test('does not send an invalid quantity and restores the previous value', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    await openWithCart(page, cart.id);

    let patches = 0;
    page.on('request', (req) => {
      if (req.method() === 'PATCH') patches += 1;
    });

    const input = page.getByTestId('cart-item-quantity-input');
    for (const invalid of ['0', 'abc', '1.5', '-1']) {
      await input.fill(invalid);
      await input.blur();
      await expect(page.getByTestId('cart-error')).toContainText('Dados inválidos');
      await expect(page.getByTestId('cart-item-quantity-input')).toHaveValue('2');
    }
    expect(patches).toBe(0);
    expect((await getCart(request, cart.id)).body.items[0]?.quantity).toBe(2);
  });

  test('shows the stock error and keeps the line when the quantity exceeds the stock', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.limitedStock, 1);
    const stock = await getStock(request, PRODUCT_NAMES.limitedStock);
    await openWithCart(page, cart.id);

    const input = page.getByTestId('cart-item-quantity-input');
    await input.fill(String(stock + 1));
    await input.blur();

    await expect(page.getByTestId('cart-error')).toContainText('Estoque insuficiente.');
    await expect(page.getByTestId('cart-item-quantity-input')).toHaveValue('1');
    expect((await getCart(request, cart.id)).body.items[0]?.quantity).toBe(1);
  });

  test('removes items and returns to the empty state after the last one', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    const regular = await findProductByName(request, PRODUCT_NAMES.regular);
    const added = await request.post(`/api/carts/${cart.id}/items`, {
      data: { productId: regular.id, quantity: 1 },
    });
    expect(added.status()).toBe(200);
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('cart-item')).toHaveCount(2);
    await page
      .getByTestId('cart-item')
      .filter({ hasText: PRODUCT_NAMES.regular })
      .getByTestId('cart-item-remove')
      .click();
    await expect(page.getByTestId('cart-item')).toHaveCount(1);
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');

    await page.getByTestId('cart-item-remove').click();
    await expect(page.getByTestId('cart-item')).toHaveCount(0);
    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await expect(page.getByTestId('cart-status')).toHaveText('Vazio');
    await expect(page.getByTestId('cart-count')).toHaveText('0');
  });
});

test.describe('checkout and confirmation (RF-014, RF-016)', () => {
  test('goes from the list to a created order and lowers the listed stock', async ({
    page,
    request,
  }) => {
    // Other specs also consume this product in parallel, so the stock is checked by difference.
    const before = await getStock(request, PRODUCT_NAMES.highStock);

    await page.goto('/');
    await addToCartFromList(page, PRODUCT_NAMES.highStock);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await openCart(page);

    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await page.getByTestId('confirm-button').click();

    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    const summary = page.getByTestId('order-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByTestId('order-id')).toHaveText(/^\d+$/);
    await expect(summary.getByTestId('order-item')).toHaveCount(1);
    await expect(summary.getByTestId('order-item')).toContainText(PRODUCT_NAMES.highStock);
    await expect(summary.getByTestId('order-discount')).toHaveText(brl(0));
    await expect(summary.getByTestId('order-total')).toHaveText(brl(HIGH_STOCK_PRICE));
    await expect(page.getByTestId('new-cart-button')).toBeVisible();
    await expect(page.getByTestId('confirm-button')).toHaveCount(0);

    await page.getByTestId('products-link').click();
    const stockText = productCard(page, PRODUCT_NAMES.highStock).getByTestId('product-stock');
    await expect(stockText).toHaveText(/^Estoque: \d+$/);
    const shown = Number(((await stockText.textContent()) ?? '').replace(/\D/g, ''));
    const after = await getStock(request, PRODUCT_NAMES.highStock);
    expect(shown).toBeLessThanOrEqual(before - 1);
    expect(shown).toBeGreaterThanOrEqual(after);
  });
});

test.describe('cart continuity (RF-015, RF-016)', () => {
  test('restores a cart in with_items after reload', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 2);
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');
    await expect(page.getByTestId('cart-item')).toHaveCount(1);
    await expect(page.getByTestId('cart-count')).toHaveText('2');
    await expect(page.getByTestId('checkout-button')).toBeVisible();
  });

  test('restores a cart in in_checkout after reload', async ({ page, request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await expect(page.getByTestId('confirm-button')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('restores a cart in order_created without the order summary', async ({ page, request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
    expect((await confirm(request, cart.id)).status).toBe(201);
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    await expect(page.getByTestId('cart-total')).toHaveText(brl(HIGH_STOCK_PRICE));
    await expect(page.getByTestId('order-summary')).toHaveCount(0);
    await expect(page.getByTestId('new-cart-button')).toBeVisible();
  });

  test('discards a stored cart id that no longer exists', async ({ page }) => {
    await openWithCart(page, 999999999, '#/');

    await expect.poll(() => storedCartId(page)).toBeNull();
    await expect(page.getByTestId('cart-count')).toHaveText('0');
    await openCart(page);
    await expect(page.getByTestId('cart-empty')).toBeVisible();
  });

  test('"Novo carrinho" drops the stored id and the next add creates another cart', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    expect((await abandon(request, cart.id)).status).toBe(200);
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('cart-status')).toHaveText('Abandonado');
    await page.getByTestId('new-cart-button').click();
    await expect(page).toHaveURL(/#\/$/);
    await expect.poll(() => storedCartId(page)).toBeNull();
    await expect(page.getByTestId('cart-count')).toHaveText('0');

    await addToCartFromList(page, PRODUCT_NAMES.highStock);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    const newId = await storedCartId(page);
    expect(newId).not.toBeNull();
    expect(newId).not.toBe(String(cart.id));
  });
});
