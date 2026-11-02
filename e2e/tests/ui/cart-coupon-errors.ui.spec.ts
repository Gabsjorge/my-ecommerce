import { expect, test, type Page } from '@playwright/test';
import {
  abandon,
  addItem,
  applyCoupon,
  cartInCheckout,
  cartWithItem,
  checkout,
  confirm,
  COUPON_CODES,
  createCart,
  edit,
  expectError,
  findProductByName,
  getCart,
  PRODUCT_NAMES,
  updateItem,
  type ApiResult,
  type CartView,
} from '../../support/api';
import { brl, openWithCart } from '../../support/ui';

// Every test builds its own cart. State is prepared through the API and the UI is used only for what is
// under test, so each flow stays well inside the 10 s inactivity timeout of the test environment.

const UNIT_PRICE = 1000;
const TEN_UNITS = 10 * UNIT_PRICE;

async function cartWithTenUnits(request: Parameters<typeof cartWithItem>[0]): Promise<CartView> {
  return (await cartWithItem(request, PRODUCT_NAMES.highStock, 10)).cart;
}

async function applyCouponInUi(page: Page, code: string): Promise<void> {
  await page.getByTestId('coupon-input').fill(code);
  await page.getByTestId('coupon-apply').click();
}

test.describe('coupon discounts (RN-015)', () => {
  const cases = [
    { code: COUPON_CODES.percentage, discount: 1000 },
    { code: COUPON_CODES.fixed, discount: 2000 },
  ];

  for (const { code, discount } of cases) {
    test(`applies ${code} and removes it again`, async ({ page, request }) => {
      const cart = await cartWithTenUnits(request);
      await openWithCart(page, cart.id);

      // Lower case on purpose: the code is case-insensitive (RN-014).
      await applyCouponInUi(page, code.toLowerCase());
      await expect(page.getByTestId('coupon-code')).toHaveText(code);
      await expect(page.getByTestId('cart-subtotal')).toHaveText(brl(TEN_UNITS));
      await expect(page.getByTestId('cart-discount')).toHaveText(brl(discount));
      await expect(page.getByTestId('cart-total')).toHaveText(brl(TEN_UNITS - discount));
      await expect(page.getByTestId('coupon-input')).toHaveCount(0);

      await page.getByTestId('coupon-remove').click();
      await expect(page.getByTestId('coupon-code')).toHaveCount(0);
      await expect(page.getByTestId('cart-discount')).toHaveText(brl(0));
      await expect(page.getByTestId('cart-total')).toHaveText(brl(TEN_UNITS));
      await expect(page.getByTestId('coupon-input')).toBeVisible();
    });
  }

  test('"Voltar a editar" keeps the applied coupon (RF-009)', async ({ page, request }) => {
    const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 10);
    const applied = await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage });
    expect(applied.status).toBe(200);
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await page.getByTestId('edit-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');
    await expect(page.getByTestId('coupon-code')).toHaveText(COUPON_CODES.percentage);
    await expect(page.getByTestId('cart-total')).toHaveText(brl(TEN_UNITS - 1000));
  });

  test('offers no coupon form while a coupon is applied (RN-012)', async ({ page, request }) => {
    const cart = await cartWithTenUnits(request);
    expect((await applyCoupon(request, cart.id, { code: COUPON_CODES.percentage })).status).toBe(
      200,
    );
    await openWithCart(page, cart.id);

    await expect(page.getByTestId('coupon-code')).toHaveText(COUPON_CODES.percentage);
    await expect(page.getByTestId('coupon-input')).toHaveCount(0);
    await expect(page.getByTestId('coupon-apply')).toHaveCount(0);
  });
});

test.describe('coupon errors in pt-BR (RN-010, RN-023)', () => {
  const cases = [
    { code: COUPON_CODES.expired, message: 'Cupom expirado.' },
    { code: COUPON_CODES.used, message: 'Este cupom já foi utilizado.' },
    { code: COUPON_CODES.minOrder, message: 'O pedido não atinge o valor mínimo do cupom.' },
    { code: 'NAO-EXISTE', message: 'Cupom não encontrado.' },
    { code: 'ab', message: 'Dados inválidos. Verifique o que foi informado.' },
  ];

  for (const { code, message } of cases) {
    test(`shows "${message}" for ${code} and leaves the cart unchanged`, async ({
      page,
      request,
    }) => {
      const cart = await cartWithTenUnits(request);
      await openWithCart(page, cart.id);

      await applyCouponInUi(page, code);
      await expect(page.getByTestId('cart-error')).toHaveText(message);
      await expect(page.getByTestId('coupon-code')).toHaveCount(0);
      await expect(page.getByTestId('coupon-input')).toBeVisible();
      await expect(page.getByTestId('cart-discount')).toHaveText(brl(0));
      await expect(page.getByTestId('cart-total')).toHaveText(brl(TEN_UNITS));
      expect((await getCart(request, cart.id)).body.coupon).toBeNull();
    });
  }
});

type Control =
  | 'checkout-button'
  | 'edit-button'
  | 'confirm-button'
  | 'abandon-button'
  | 'new-cart-button'
  | 'coupon-input'
  | 'cart-item-remove';

const ALL_CONTROLS: Control[] = [
  'checkout-button',
  'edit-button',
  'confirm-button',
  'abandon-button',
  'new-cart-button',
  'coupon-input',
  'cart-item-remove',
];

async function expectControls(page: Page, visible: Control[]): Promise<void> {
  for (const control of ALL_CONTROLS) {
    const locator = page.getByTestId(control).first();
    if (visible.includes(control)) await expect(locator).toBeVisible();
    else await expect(page.getByTestId(control)).toHaveCount(0);
  }
}

interface StateCase {
  state: string;
  label: string;
  setup: (request: Parameters<typeof cartWithItem>[0]) => Promise<CartView>;
  visible: Control[];
  // null: the cart has no item line.
  quantityEditable: boolean | null;
  // Writes the server must refuse in this state; keeps the UI mirror honest (RN-018, RN-024).
  forbidden: (
    request: Parameters<typeof cartWithItem>[0],
    cartId: number,
    productId: number,
  ) => Promise<ApiResult<unknown>[]>;
}

const STATE_CASES: StateCase[] = [
  {
    state: 'empty',
    label: 'Vazio',
    setup: async (request) => {
      const created = await createCart(request);
      expect(created.status).toBe(201);
      return created.body;
    },
    visible: [],
    quantityEditable: null,
    forbidden: async (request, cartId) => [
      await abandon(request, cartId),
      await checkout(request, cartId),
      await applyCoupon(request, cartId, { code: COUPON_CODES.percentage }),
    ],
  },
  {
    state: 'with_items',
    label: 'Com Itens',
    setup: async (request) => (await cartWithItem(request, PRODUCT_NAMES.highStock, 1)).cart,
    visible: ['checkout-button', 'abandon-button', 'coupon-input', 'cart-item-remove'],
    quantityEditable: true,
    forbidden: async (request, cartId) => [
      await edit(request, cartId),
      await confirm(request, cartId),
    ],
  },
  {
    state: 'in_checkout',
    label: 'Em Checkout',
    setup: async (request) => (await cartInCheckout(request, PRODUCT_NAMES.highStock, 1)).cart,
    visible: ['edit-button', 'confirm-button', 'abandon-button', 'coupon-input'],
    quantityEditable: false,
    forbidden: async (request, cartId, productId) => [
      await checkout(request, cartId),
      await addItem(request, cartId, { productId, quantity: 1 }),
      await updateItem(request, cartId, productId, { quantity: 2 }),
    ],
  },
  {
    state: 'abandoned',
    label: 'Abandonado',
    setup: async (request) => {
      const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
      return (await abandon(request, cart.id)).body;
    },
    visible: ['new-cart-button'],
    quantityEditable: false,
    forbidden: async (request, cartId, productId) => [
      await addItem(request, cartId, { productId, quantity: 1 }),
      await checkout(request, cartId),
      await applyCoupon(request, cartId, { code: COUPON_CODES.percentage }),
    ],
  },
  {
    state: 'order_created',
    label: 'Pedido Criado',
    setup: async (request) => {
      const { cart } = await cartInCheckout(request, PRODUCT_NAMES.highStock, 1);
      return (await confirm(request, cart.id)).body.cart;
    },
    visible: ['new-cart-button'],
    quantityEditable: false,
    forbidden: async (request, cartId) => [
      await confirm(request, cartId),
      await abandon(request, cartId),
      await edit(request, cartId),
    ],
  },
];

test.describe('controls follow the cart state (RN-018, RN-024)', () => {
  for (const stateCase of STATE_CASES) {
    test(`${stateCase.state}: UI controls match what the server allows`, async ({
      page,
      request,
    }) => {
      const cart = await stateCase.setup(request);
      expect(cart.status).toBe(stateCase.state);
      await openWithCart(page, cart.id);

      await expect(page.getByTestId('cart-status')).toHaveText(stateCase.label);
      await expectControls(page, stateCase.visible);
      if (stateCase.quantityEditable === null) {
        await expect(page.getByTestId('cart-empty')).toBeVisible();
      } else {
        const input = page.getByTestId('cart-item-quantity-input');
        if (stateCase.quantityEditable) await expect(input).toBeEnabled();
        else await expect(input).toBeDisabled();
      }

      // The server refuses what the UI hides, and the cart stays as it was.
      const product = await findProductByName(request, PRODUCT_NAMES.highStock);
      for (const result of await stateCase.forbidden(request, cart.id, product.id)) {
        expectError(result, 409, 'INVALID_CART_STATE');
      }
      expect((await getCart(request, cart.id)).body.status).toBe(stateCase.state);
    });
  }

  test('abandoning from the UI makes the cart read-only with "Novo carrinho" (RF-010)', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    await openWithCart(page, cart.id);

    await page.getByTestId('abandon-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Abandonado');
    await expectControls(page, ['new-cart-button']);
    await expect(page.getByTestId('cart-item-quantity-input')).toBeDisabled();
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });
});

test.describe('confirmation failures (RN-009, RN-011, RN-023)', () => {
  test('insufficient stock lists the item and keeps the cart in checkout', async ({
    page,
    request,
  }) => {
    // Both carts hold the only unit; the second one is confirmed first through the API.
    const mine = await cartInCheckout(request, PRODUCT_NAMES.uiLastUnit, 1);
    const other = await cartInCheckout(request, PRODUCT_NAMES.uiLastUnit, 1);
    expect((await confirm(request, other.cart.id)).status).toBe(201);
    await openWithCart(page, mine.cart.id);

    await page.getByTestId('confirm-button').click();
    const error = page.getByTestId('cart-error');
    await expect(error).toContainText('Estoque insuficiente.');
    await expect(error).toContainText(`${PRODUCT_NAMES.uiLastUnit}: pedido 1, disponível 0`);
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await expect(page.getByTestId('order-summary')).toHaveCount(0);
    expect((await getCart(request, mine.cart.id)).body.status).toBe('in_checkout');
  });

  test('confirms with a percentage coupon, which cannot be reused afterwards', async ({
    page,
    request,
  }) => {
    const cart = await cartWithTenUnits(request);
    await openWithCart(page, cart.id);

    await applyCouponInUi(page, COUPON_CODES.uiConsumable);
    await expect(page.getByTestId('cart-total')).toHaveText(brl(TEN_UNITS - 1000));
    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-status')).toHaveText('Em Checkout');
    await page.getByTestId('confirm-button').click();

    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    await expect(page.getByTestId('order-discount')).toHaveText(brl(1000));
    await expect(page.getByTestId('order-total')).toHaveText(brl(TEN_UNITS - 1000));

    const next = await cartWithTenUnits(request);
    await openWithCart(page, next.id);
    await applyCouponInUi(page, COUPON_CODES.uiConsumable);
    await expect(page.getByTestId('cart-error')).toHaveText('Este cupom já foi utilizado.');
  });

  test('confirms with a fixed coupon larger than the subtotal (total 0)', async ({
    page,
    request,
  }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    await openWithCart(page, cart.id);

    await applyCouponInUi(page, COUPON_CODES.uiConsumableFixed);
    await expect(page.getByTestId('cart-discount')).toHaveText(brl(UNIT_PRICE));
    await expect(page.getByTestId('cart-total')).toHaveText(brl(0));
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('confirm-button').click();

    await expect(page.getByTestId('cart-status')).toHaveText('Pedido Criado');
    await expect(page.getByTestId('order-discount')).toHaveText(brl(UNIT_PRICE));
    await expect(page.getByTestId('order-total')).toHaveText(brl(0));
  });
});

test.describe('inactivity timeout on screen (RN-020, RN-024)', () => {
  // The test environment sets CART_INACTIVITY_TIMEOUT_SECONDS=10 (.env.test); this test waits in real time.
  test.setTimeout(40_000);
  const PAST_TIMEOUT_MS = 11_500;

  test('a write after the timeout reloads the cart as abandoned', async ({ page, request }) => {
    const { cart } = await cartWithItem(request, PRODUCT_NAMES.highStock, 1);
    // Opening the cart only reads it, so it does not renew the inactivity counter.
    await openWithCart(page, cart.id);
    await expect(page.getByTestId('cart-status')).toHaveText('Com Itens');

    // The timeout runs on the server clock; there is no UI signal to wait for.
    await new Promise((resolve) => setTimeout(resolve, PAST_TIMEOUT_MS));

    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('cart-error')).toHaveText(
      'Esta operação não está disponível para o estado atual do carrinho.',
    );
    await expect(page.getByTestId('cart-status')).toHaveText('Abandonado');
    await expect(page.getByTestId('new-cart-button')).toBeVisible();
    expect((await getCart(request, cart.id)).body.status).toBe('abandoned');
  });
});
