import { expect, type Locator, type Page } from '@playwright/test';

// UI-only helpers. Selectors use data-testid only; products are located by name, never by id.

const CART_ID_KEY = 'ecommerce.cartId';

export function productCard(page: Page, name: string): Locator {
  return page
    .getByTestId('product-item')
    .filter({ has: page.getByTestId('product-name').getByText(name, { exact: true }) });
}

export async function addToCartFromList(page: Page, name: string): Promise<void> {
  await productCard(page, name).getByTestId('add-to-cart-button').click();
}

export async function openCart(page: Page): Promise<void> {
  await page.getByTestId('cart-link').click();
  await expect(page).toHaveURL(/#\/cart$/);
}

// Independent pt-BR money pattern for assertions (does not reuse frontend code).
// \s covers the non-breaking space emitted by Intl.
export function brl(cents: number): RegExp {
  const reais = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\\.');
  const fraction = (cents % 100).toString().padStart(2, '0');
  return new RegExp(`R\\$\\s*${reais},${fraction}`);
}

export async function storedCartId(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), CART_ID_KEY);
}

// Stores a cart id in the browser and reloads, so the app restores it (RF-015).
export async function openWithCart(page: Page, cartId: number | string, hash = '#/cart') {
  await page.goto('/');
  await page.evaluate(
    ([key, id]) => window.localStorage.setItem(key, id),
    [CART_ID_KEY, String(cartId)],
  );
  await page.goto(`/${hash}`);
  await page.reload();
}
