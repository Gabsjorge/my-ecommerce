import { vi } from 'vitest';
import type { CouponRepositoryPort } from '../modules/coupons/coupon.types';
import type { OrderRepositoryPort } from '../modules/orders/order.types';
import type { ProductRepositoryPort } from '../modules/products/product.types';
import type { CartDetails, CartRecord, CartRepositoryPort } from '../modules/carts/cart.types';
import type { TxRepositories, UnitOfWork } from '../modules/carts/cart.unit-of-work';

export const NOW = new Date('2030-01-01T12:00:00Z');
export const TIMEOUT_MS = 10_000;

export function makeCart(overrides: Partial<CartRecord> = {}): CartRecord {
  return {
    id: 1,
    status: 'empty',
    couponId: null,
    createdAt: NOW,
    lastActivityAt: NOW,
    ...overrides,
  };
}

export function makeRepos() {
  const carts: { [K in keyof CartRepositoryPort]: ReturnType<typeof vi.fn> } = {
    create: vi.fn(),
    lockById: vi.fn(),
    findDetails: vi.fn(),
    findItem: vi.fn(),
    insertItem: vi.fn().mockResolvedValue(undefined),
    updateQuantity: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    setCoupon: vi.fn().mockResolvedValue(undefined),
    touch: vi.fn().mockResolvedValue(undefined),
    abandonIfExpired: vi.fn().mockResolvedValue(false),
  };
  const coupons: { [K in keyof CouponRepositoryPort]: ReturnType<typeof vi.fn> } = {
    findByCode: vi.fn(),
    lockById: vi.fn(),
    markUsed: vi.fn().mockResolvedValue(true),
  };
  const products: { [K in keyof ProductRepositoryPort]: ReturnType<typeof vi.fn> } = {
    findAll: vi.fn(),
    findById: vi.fn(),
    lockByIds: vi.fn(),
    decrementStock: vi.fn().mockResolvedValue(true),
  };
  const orders: { [K in keyof OrderRepositoryPort]: ReturnType<typeof vi.fn> } = {
    create: vi.fn(),
  };
  const repos = { carts, coupons, products, orders } as unknown as TxRepositories;
  // Fake unit of work: runs the work directly against the mocks (no real transaction).
  const unitOfWork: UnitOfWork = { run: (work) => work(repos) };
  return { carts, coupons, products, orders, unitOfWork };
}

export function details(overrides: Partial<CartDetails> = {}): CartDetails {
  return { cart: makeCart(), items: [], coupon: null, ...overrides };
}
