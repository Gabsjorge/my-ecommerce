// @ts-check
import { fetchProducts } from './api/products.api.js';
import {
  renderEmpty,
  renderError,
  renderLoading,
  renderProducts,
} from './views/product-list.view.js';

async function main() {
  const root = document.getElementById('app');
  if (!root) return;

  renderLoading(root);
  try {
    const { data, total } = await fetchProducts();
    if (total === 0) {
      renderEmpty(root);
    } else {
      renderProducts(root, data);
    }
  } catch {
    renderError(root, 'Não foi possível carregar os produtos.');
  }
}

main();
