import { expect, type APIRequestContext } from '@playwright/test';

// Black-box helpers: plain HTTP only, nothing is imported from the backend.
// Product names and coupon codes duplicate the seed on purpose (products are looked up by name, never by id).

export const PRODUCT_NAMES = {
  highStock: 'Caneta Esferográfica Azul (Estoque Alto)',
  lastItem: 'Edição Limitada Caderno Artesanal (Último Item)',
  limitedStock: 'Mochila Escolar Compacta (Estoque Limitado)',
  outOfStock: 'Caderno Universitário 200 folhas',
  regular: 'Camiseta Básica Algodão',
  uiLastUnit: 'Agenda Anual Última Unidade (UI)',
} as const;

export const COUPON_CODES = {
  percentage: 'DESC10',
  fixed: 'FIXO20',
  full: 'MEGA100',
  fixedAboveSubtotal: 'FIXO5000',
  minOrder: 'MIN200',
  expired: 'EXPIRADO10',
  used: 'USADO10',
  consumable: 'CONFIRMA10',
  consumableFixed: 'ZERA-FIXO',
  dispute: 'DISPUTA10',
  uiConsumable: 'UI-CONFIRMA10',
  uiConsumableFixed: 'UI-ZERA-FIXO',
} as const;

export type CartStatus = 'empty' | 'with_items' | 'in_checkout' | 'order_created' | 'abandoned';

export interface Product {
  id: number;
  name: string;
  priceCents: number;
  stock: number;
}

export interface CartItem {
  productId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
}

export interface CartView {
  id: number;
  status: CartStatus;
  items: CartItem[];
  coupon: { code: string; type: 'percentage' | 'fixed'; value: number } | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export interface OrderView {
  id: number;
  cartId: number;
  status: string;
  items: Omit<CartItem, 'subtotalCents'>[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponCode: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: { items?: StockShortage[] } };
}

export interface StockShortage {
  productId: number;
  requested: number;
  available: number;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

type Json = Record<string, unknown>;

async function toResult<T>(res: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<ApiResult<T>> {
  return { status: res.status(), body: (await res.json()) as T };
}

export async function listProducts(request: APIRequestContext): Promise<Product[]> {
  const res = await request.get('/api/products');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: Product[] }).data;
}

export async function findProductByName(
  request: APIRequestContext,
  name: string,
): Promise<Product> {
  const product = (await listProducts(request)).find((p) => p.name === name);
  if (!product) throw new Error(`Seed product not found: ${name}`);
  return product;
}

export async function getStock(request: APIRequestContext, name: string): Promise<number> {
  return (await findProductByName(request, name)).stock;
}

export const createCart = async (request: APIRequestContext): Promise<ApiResult<CartView>> =>
  toResult(await request.post('/api/carts'));

export const getCart = async (
  request: APIRequestContext,
  cartId: number | string,
): Promise<ApiResult<CartView>> => toResult(await request.get(`/api/carts/${cartId}`));

export const addItem = async (
  request: APIRequestContext,
  cartId: number | string,
  body: Json,
): Promise<ApiResult<CartView>> =>
  toResult(await request.post(`/api/carts/${cartId}/items`, { data: body }));

export const updateItem = async (
  request: APIRequestContext,
  cartId: number | string,
  productId: number | string,
  body: Json,
): Promise<ApiResult<CartView>> =>
  toResult(await request.patch(`/api/carts/${cartId}/items/${productId}`, { data: body }));

export const removeItem = async (
  request: APIRequestContext,
  cartId: number | string,
  productId: number | string,
): Promise<ApiResult<CartView>> =>
  toResult(await request.delete(`/api/carts/${cartId}/items/${productId}`));

export const applyCoupon = async (
  request: APIRequestContext,
  cartId: number | string,
  body: Json,
): Promise<ApiResult<CartView>> =>
  toResult(await request.post(`/api/carts/${cartId}/coupon`, { data: body }));

export const removeCoupon = async (
  request: APIRequestContext,
  cartId: number | string,
): Promise<ApiResult<CartView>> => toResult(await request.delete(`/api/carts/${cartId}/coupon`));

async function action(
  request: APIRequestContext,
  cartId: number | string,
  name: 'checkout' | 'edit' | 'abandon',
): Promise<ApiResult<CartView>> {
  return toResult(await request.post(`/api/carts/${cartId}/${name}`));
}

export const checkout = (request: APIRequestContext, cartId: number | string) =>
  action(request, cartId, 'checkout');
export const edit = (request: APIRequestContext, cartId: number | string) =>
  action(request, cartId, 'edit');
export const abandon = (request: APIRequestContext, cartId: number | string) =>
  action(request, cartId, 'abandon');

export const confirm = async (
  request: APIRequestContext,
  cartId: number | string,
): Promise<ApiResult<{ order: OrderView; cart: CartView }>> =>
  toResult(await request.post(`/api/carts/${cartId}/confirm`));

// Creates a cart and adds `quantity` units of the product (found by name); fails fast if any step fails.
export async function cartWithItem(
  request: APIRequestContext,
  productName: string,
  quantity: number,
): Promise<{ cart: CartView; product: Product }> {
  const product = await findProductByName(request, productName);
  const created = await createCart(request);
  expect(created.status).toBe(201);
  const added = await addItem(request, created.body.id, { productId: product.id, quantity });
  expect(added.status).toBe(200);
  return { cart: added.body, product };
}

// Same as cartWithItem, then moves the cart to in_checkout.
export async function cartInCheckout(
  request: APIRequestContext,
  productName: string,
  quantity: number,
): Promise<{ cart: CartView; product: Product }> {
  const { cart, product } = await cartWithItem(request, productName, quantity);
  const res = await checkout(request, cart.id);
  expect(res.status).toBe(200);
  return { cart: res.body, product };
}

// Asserts the standard error envelope: HTTP status, business code and a non-empty message.
export function expectError(res: ApiResult<unknown>, status: number, code: string): void {
  expect(res.status).toBe(status);
  const { error } = res.body as ApiErrorBody;
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
}
