import { expect, test } from '@playwright/test';

interface ApiProduct {
  id: number;
  name: string;
  priceCents: number;
  stock: number;
}

test.describe('product list page', () => {
  test('shows the 6 products with the first name visible', async ({ page }) => {
    await page.goto('/');
    const items = page.getByTestId('product-item');
    await expect(items).toHaveCount(6);
    await expect(items.first().getByTestId('product-name')).toHaveText('Camiseta Básica Algodão');
  });

  test('formats the price in pt-BR', async ({ page }) => {
    await page.goto('/');
    // \s covers the non-breaking space emitted by Intl.
    await expect(page.getByTestId('product-price').first()).toHaveText(/R\$\s*49,90/);
  });

  test('shows the out-of-stock badge only for products with stock 0', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('product-item')).toHaveCount(6);
    await expect(page.getByTestId('out-of-stock-badge')).toHaveCount(1);
    await expect(page.getByTestId('out-of-stock-badge')).toHaveText('Sem estoque');
    const outOfStock = page.getByTestId('product-item').filter({
      has: page.getByTestId('out-of-stock-badge'),
    });
    await expect(outOfStock.getByTestId('product-name')).toHaveText(
      'Caderno Universitário 200 folhas',
    );
  });

  test('displayed data matches GET /api/products', async ({ page }) => {
    const res = await page.request.get('/api/products');
    const { data } = (await res.json()) as { data: ApiProduct[] };

    await page.goto('/');
    const items = page.getByTestId('product-item');
    await expect(items).toHaveCount(data.length);

    for (const [index, product] of data.entries()) {
      const item = items.nth(index);
      await expect(item.getByTestId('product-name')).toHaveText(product.name);
      await expect(item.getByTestId('product-price')).toHaveText(
        new RegExp(`R\\$\\s*${formatBrl(product.priceCents)}`),
      );
    }
  });

  test('shows the error state when the API fails', async ({ page }) => {
    await page.route('**/api/products', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x' } }),
      }),
    );
    await page.goto('/');
    await expect(page.getByTestId('error-message')).toBeVisible();
  });

  test('shows the empty state when there are no products', async ({ page }) => {
    await page.route('**/api/products', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], total: 0 }),
      }),
    );
    await page.goto('/');
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });
});

// Independent pt-BR formatting for the assertion (does not reuse frontend code).
function formatBrl(cents: number): string {
  const reais = Math.floor(cents / 100).toString();
  const withThousands = reais.replace(/\B(?=(\d{3})+(?!\d))/g, '\\.');
  return `${withThousands},${(cents % 100).toString().padStart(2, '0')}`;
}
