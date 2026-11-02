import { describe, expect, it, vi } from 'vitest';
import { details, makeCart, makeRepos, NOW, TIMEOUT_MS } from '../../test-support/cart-mocks';
import { CartService } from './cart.service';
import type { Operation } from './cart.state';

function build(clockNow: Date = NOW) {
  const repos = makeRepos();
  const service = new CartService({
    carts: repos.carts as never,
    unitOfWork: repos.unitOfWork,
    clock: () => clockNow,
    inactivityTimeoutMs: TIMEOUT_MS,
  });
  return { repos, service };
}

// Exposes the protected lock helper so the timeout behavior can be tested before any write exists.
class ProbeService extends CartService {
  write(cartId: number, operation: Operation) {
    return this.withCartLock(cartId, operation, (locked) => this.finishWrite(locked));
  }
}

function buildProbe(clockNow: Date) {
  const repos = makeRepos();
  const service = new ProbeService({
    carts: repos.carts as never,
    unitOfWork: repos.unitOfWork,
    clock: () => clockNow,
    inactivityTimeoutMs: TIMEOUT_MS,
  });
  return { repos, service };
}

const after = (ms: number) => new Date(NOW.getTime() + ms);

describe('CartService.createCart', () => {
  it('creates an empty cart without items or coupon (RF-001)', async () => {
    const { repos, service } = build();
    repos.carts.create.mockResolvedValue(makeCart({ id: 7 }));

    const view = await service.createCart();

    expect(repos.carts.create).toHaveBeenCalledWith(NOW);
    expect(view).toEqual({
      id: 7,
      status: 'empty',
      items: [],
      coupon: null,
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });
});

describe('CartService.getCart', () => {
  it('builds the view with line subtotals and the coupon discount (RF-002, RN-015)', async () => {
    const { repos, service } = build();
    repos.carts.findDetails.mockResolvedValue(
      details({
        cart: makeCart({ id: 3, status: 'with_items', couponId: 9 }),
        items: [
          { productId: 1, name: 'A', quantity: 2, unitPriceCents: 1000 },
          { productId: 2, name: 'B', quantity: 1, unitPriceCents: 550 },
        ],
        coupon: { id: 9, code: 'DESC10', type: 'percentage', value: 10 },
      }),
    );

    const view = await service.getCart(3);

    expect(view).toEqual({
      id: 3,
      status: 'with_items',
      items: [
        { productId: 1, name: 'A', quantity: 2, unitPriceCents: 1000, subtotalCents: 2000 },
        { productId: 2, name: 'B', quantity: 1, unitPriceCents: 550, subtotalCents: 550 },
      ],
      coupon: { code: 'DESC10', type: 'percentage', value: 10 },
      subtotalCents: 2550,
      discountCents: 255,
      totalCents: 2295,
    });
  });

  it('throws CART_NOT_FOUND for an unknown cart', async () => {
    const { repos, service } = build();
    repos.carts.findDetails.mockResolvedValue(null);
    await expect(service.getCart(99)).rejects.toMatchObject({
      code: 'CART_NOT_FOUND',
      status: 404,
    });
  });

  it('asks the repository to abandon only carts idle for more than the timeout, without touching', async () => {
    const { repos, service } = build(after(TIMEOUT_MS));
    repos.carts.findDetails.mockResolvedValue(details());

    await service.getCart(1);

    // cutoff = now - timeout: a cart idle exactly for the timeout is not older than the cutoff.
    expect(repos.carts.abandonIfExpired).toHaveBeenCalledWith(1, NOW);
    expect(repos.carts.touch).not.toHaveBeenCalled();
  });

  it('returns the abandoned state recorded by the conditional update (reads do not renew)', async () => {
    const { repos, service } = build(after(TIMEOUT_MS + 1));
    repos.carts.abandonIfExpired.mockResolvedValue(true);
    repos.carts.findDetails.mockResolvedValue(details({ cart: makeCart({ status: 'abandoned' }) }));

    expect((await service.getCart(1)).status).toBe('abandoned');
    expect(repos.carts.touch).not.toHaveBeenCalled();
    expect(repos.carts.setStatus).not.toHaveBeenCalled();
  });
});

describe('CartService.withCartLock (timeout, RN-020)', () => {
  it('throws CART_NOT_FOUND when the lock finds no cart', async () => {
    const { repos, service } = buildProbe(NOW);
    repos.carts.lockById.mockResolvedValue(null);
    await expect(service.write(1, 'ADD_ITEM')).rejects.toMatchObject({ code: 'CART_NOT_FOUND' });
  });

  it.each(['with_items', 'in_checkout'] as const)(
    'records %s as abandoned and refuses the write when idle for more than the timeout',
    async (status) => {
      const { repos, service } = buildProbe(after(TIMEOUT_MS + 1));
      repos.carts.lockById.mockResolvedValue(makeCart({ status }));

      await expect(service.write(1, 'ADD_ITEM')).rejects.toMatchObject({
        code: 'INVALID_CART_STATE',
        status: 409,
      });
      expect(repos.carts.setStatus).toHaveBeenCalledWith(1, 'abandoned');
      expect(repos.carts.touch).not.toHaveBeenCalled();
    },
  );

  it('abandons by returning (commit), not by throwing inside the transaction', async () => {
    const { repos, service } = buildProbe(after(TIMEOUT_MS + 1));
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    const run = vi.spyOn(repos.unitOfWork, 'run');

    await expect(service.write(1, 'ADD_ITEM')).rejects.toBeDefined();

    // The transaction callback itself resolved: the real UnitOfWork would have committed.
    await expect(run.mock.results[0].value).resolves.toEqual({ kind: 'abandoned' });
  });

  it('does not expire a cart idle exactly for the timeout', async () => {
    const { repos, service } = buildProbe(after(TIMEOUT_MS));
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    repos.carts.findDetails.mockResolvedValue(
      details({ cart: makeCart({ status: 'with_items' }) }),
    );

    await expect(service.write(1, 'ADD_ITEM')).resolves.toMatchObject({ status: 'with_items' });
    expect(repos.carts.touch).toHaveBeenCalledWith(1, after(TIMEOUT_MS));
  });

  it('never abandons empty or final carts, however idle', async () => {
    for (const status of ['empty', 'order_created', 'abandoned'] as const) {
      const { repos, service } = buildProbe(after(TIMEOUT_MS * 100));
      repos.carts.lockById.mockResolvedValue(makeCart({ status }));
      repos.carts.findDetails.mockResolvedValue(details({ cart: makeCart({ status }) }));

      await service.write(1, 'ADD_ITEM');

      expect(repos.carts.setStatus).not.toHaveBeenCalled();
    }
  });
});

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  name: 'P',
  description: '',
  priceCents: 1000,
  stock: 10,
  ...overrides,
});
const line = (quantity: number, unitPriceCents = 1000) => ({
  productId: 5,
  name: 'P',
  quantity,
  unitPriceCents,
});

describe('CartService.addItem', () => {
  it('creates a line with the current price and moves empty to with_items (RF-003, RN-004)', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'empty' }));
    repos.products.findById.mockResolvedValue(product({ priceCents: 1234 }));
    repos.carts.findItem.mockResolvedValue(null);
    repos.carts.findDetails.mockResolvedValue(details());

    await service.addItem(1, 5, 2);

    expect(repos.carts.insertItem).toHaveBeenCalledWith(1, 5, 2, 1234);
    expect(repos.carts.setStatus).toHaveBeenCalledWith(1, 'with_items');
    expect(repos.carts.touch).toHaveBeenCalledWith(1, NOW);
  });

  it('sums into the existing line keeping the frozen price (RN-003, RN-004)', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    repos.products.findById.mockResolvedValue(product({ priceCents: 9999 }));
    repos.carts.findItem.mockResolvedValue(line(2, 1000));
    repos.carts.findDetails.mockResolvedValue(details());

    await service.addItem(1, 5, 3);

    expect(repos.carts.updateQuantity).toHaveBeenCalledWith(1, 5, 5);
    expect(repos.carts.insertItem).not.toHaveBeenCalled();
    expect(repos.carts.setStatus).not.toHaveBeenCalled();
  });

  it('refuses a product with stock 0 and writes nothing (RN-005)', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'empty' }));
    repos.products.findById.mockResolvedValue(product({ stock: 0 }));
    repos.carts.findItem.mockResolvedValue(null);

    await expect(service.addItem(1, 5, 1)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 409,
      details: { items: [{ productId: 5, requested: 1, available: 0 }] },
    });
    expect(repos.carts.insertItem).not.toHaveBeenCalled();
    expect(repos.carts.touch).not.toHaveBeenCalled();
  });

  it('refuses a sum above the stock and keeps the previous quantity', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    repos.products.findById.mockResolvedValue(product({ stock: 3 }));
    repos.carts.findItem.mockResolvedValue(line(2));

    await expect(service.addItem(1, 5, 2)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { items: [{ productId: 5, requested: 4, available: 3 }] },
    });
    expect(repos.carts.updateQuantity).not.toHaveBeenCalled();
  });

  it('accepts a quantity equal to the stock', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'empty' }));
    repos.products.findById.mockResolvedValue(product({ stock: 3 }));
    repos.carts.findItem.mockResolvedValue(null);
    repos.carts.findDetails.mockResolvedValue(details());

    await service.addItem(1, 5, 3);
    expect(repos.carts.insertItem).toHaveBeenCalledWith(1, 5, 3, 1000);
  });

  it('throws PRODUCT_NOT_FOUND for an unknown product', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'empty' }));
    repos.products.findById.mockResolvedValue(null);
    await expect(service.addItem(1, 5, 1)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });

  it.each(['in_checkout', 'order_created', 'abandoned'] as const)(
    'refuses in state %s before looking at the product (RN-018)',
    async (status) => {
      const { repos, service } = build();
      repos.carts.lockById.mockResolvedValue(makeCart({ status }));

      await expect(service.addItem(1, 5, 1)).rejects.toMatchObject({ code: 'INVALID_CART_STATE' });
      expect(repos.products.findById).not.toHaveBeenCalled();
    },
  );
});

describe('CartService.updateItemQuantity', () => {
  it('replaces the quantity (RF-004)', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    repos.carts.findItem.mockResolvedValue(line(2));
    repos.products.findById.mockResolvedValue(product({ stock: 10 }));
    repos.carts.findDetails.mockResolvedValue(details());

    await service.updateItemQuantity(1, 5, 7);

    expect(repos.carts.updateQuantity).toHaveBeenCalledWith(1, 5, 7);
    expect(repos.carts.touch).toHaveBeenCalled();
  });

  it('throws CART_ITEM_NOT_FOUND when there is no line', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    repos.carts.findItem.mockResolvedValue(null);
    await expect(service.updateItemQuantity(1, 5, 2)).rejects.toMatchObject({
      code: 'CART_ITEM_NOT_FOUND',
    });
  });

  it('refuses a quantity above the stock', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    repos.carts.findItem.mockResolvedValue(line(1));
    repos.products.findById.mockResolvedValue(product({ stock: 3 }));

    await expect(service.updateItemQuantity(1, 5, 4)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect(repos.carts.updateQuantity).not.toHaveBeenCalled();
  });

  it.each(['empty', 'in_checkout', 'abandoned'] as const)('refuses in state %s', async (status) => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status }));
    await expect(service.updateItemQuantity(1, 5, 2)).rejects.toMatchObject({
      code: 'INVALID_CART_STATE',
    });
  });
});

describe('CartService.removeItem', () => {
  it('keeps with_items and the coupon while items remain', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items', couponId: 3 }));
    repos.carts.findItem.mockResolvedValue(line(1));
    repos.carts.findDetails.mockResolvedValue(details({ items: [line(1)] }));

    await service.removeItem(1, 5);

    expect(repos.carts.deleteItem).toHaveBeenCalledWith(1, 5);
    expect(repos.carts.setStatus).not.toHaveBeenCalled();
    expect(repos.carts.setCoupon).not.toHaveBeenCalled();
  });

  it('returns to empty and drops the coupon when the last item goes (RN-016)', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items', couponId: 3 }));
    repos.carts.findItem.mockResolvedValue(line(1));
    repos.carts.findDetails.mockResolvedValue(details());

    await service.removeItem(1, 5);

    expect(repos.carts.setStatus).toHaveBeenCalledWith(1, 'empty');
    expect(repos.carts.setCoupon).toHaveBeenCalledWith(1, null);
  });

  it('throws CART_ITEM_NOT_FOUND without deleting', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items' }));
    repos.carts.findItem.mockResolvedValue(null);
    await expect(service.removeItem(1, 5)).rejects.toMatchObject({ code: 'CART_ITEM_NOT_FOUND' });
    expect(repos.carts.deleteItem).not.toHaveBeenCalled();
  });

  it.each(['empty', 'in_checkout', 'order_created'] as const)(
    'refuses in state %s',
    async (status) => {
      const { repos, service } = build();
      repos.carts.lockById.mockResolvedValue(makeCart({ status }));
      await expect(service.removeItem(1, 5)).rejects.toMatchObject({ code: 'INVALID_CART_STATE' });
    },
  );
});

const coupon = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  code: 'DESC10',
  type: 'percentage' as const,
  value: 10,
  minOrderCents: 0,
  expiresAt: new Date('2099-12-31T00:00:00Z'),
  usedAt: null,
  ...overrides,
});

function couponScenario(cartOverrides = {}, items = [line(2)]) {
  const ctx = build();
  ctx.repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items', ...cartOverrides }));
  ctx.repos.carts.findDetails.mockResolvedValue(details({ items }));
  return ctx;
}

describe('CartService.applyCoupon', () => {
  it('associates a valid coupon and registers the write (RF-006)', async () => {
    const { repos, service } = couponScenario();
    repos.coupons.findByCode.mockResolvedValue(coupon());

    await service.applyCoupon(1, 'DESC10');

    expect(repos.coupons.findByCode).toHaveBeenCalledWith('DESC10');
    expect(repos.carts.setCoupon).toHaveBeenCalledWith(1, 9);
    expect(repos.carts.touch).toHaveBeenCalled();
  });

  it('works in in_checkout too', async () => {
    const { repos, service } = couponScenario({ status: 'in_checkout' });
    repos.coupons.findByCode.mockResolvedValue(coupon());
    await service.applyCoupon(1, 'DESC10');
    expect(repos.carts.setCoupon).toHaveBeenCalledWith(1, 9);
  });

  it('refuses an empty cart with INVALID_CART_STATE before looking at the coupon', async () => {
    const { repos, service } = couponScenario({ status: 'empty' }, []);
    await expect(service.applyCoupon(1, 'DESC10')).rejects.toMatchObject({
      code: 'INVALID_CART_STATE',
    });
    expect(repos.coupons.findByCode).not.toHaveBeenCalled();
  });

  it.each(['order_created', 'abandoned'] as const)('refuses in state %s', async (status) => {
    const { service } = couponScenario({ status });
    await expect(service.applyCoupon(1, 'DESC10')).rejects.toMatchObject({
      code: 'INVALID_CART_STATE',
    });
  });

  // RN-010 order: exists, not already applied, not expired, not used, minimum.
  it.each([
    ['COUPON_NOT_FOUND', null, {}],
    ['COUPON_ALREADY_APPLIED', coupon(), { couponId: 4 }],
    ['COUPON_EXPIRED', coupon({ expiresAt: new Date('2020-01-01T00:00:00Z') }), {}],
    ['COUPON_ALREADY_USED', coupon({ usedAt: new Date('2020-01-01T00:00:00Z') }), {}],
    ['COUPON_MIN_ORDER_NOT_MET', coupon({ minOrderCents: 999999 }), {}],
  ])('fails with %s and leaves the cart untouched', async (code, found, cartOverrides) => {
    const { repos, service } = couponScenario(cartOverrides);
    repos.coupons.findByCode.mockResolvedValue(found);

    await expect(service.applyCoupon(1, 'X')).rejects.toMatchObject({ code });
    expect(repos.carts.setCoupon).not.toHaveBeenCalled();
    expect(repos.carts.touch).not.toHaveBeenCalled();
  });

  it('reports already-applied before expired and used when several problems coexist', async () => {
    const { repos, service } = couponScenario({ couponId: 4 });
    repos.coupons.findByCode.mockResolvedValue(
      coupon({ expiresAt: new Date('2020-01-01T00:00:00Z'), usedAt: new Date() }),
    );
    await expect(service.applyCoupon(1, 'X')).rejects.toMatchObject({
      code: 'COUPON_ALREADY_APPLIED',
    });
  });

  it('compares the minimum against the subtotal before any discount', async () => {
    const { repos, service } = couponScenario({}, [line(2, 1000)]);
    repos.coupons.findByCode.mockResolvedValue(coupon({ minOrderCents: 2000 }));
    await service.applyCoupon(1, 'DESC10');
    expect(repos.carts.setCoupon).toHaveBeenCalledWith(1, 9);
  });
});

describe('CartService.removeCoupon', () => {
  it('clears the coupon (RF-007)', async () => {
    const { repos, service } = couponScenario({ couponId: 9 });
    await service.removeCoupon(1);
    expect(repos.carts.setCoupon).toHaveBeenCalledWith(1, null);
  });

  it('fails with COUPON_NOT_APPLIED when there is none', async () => {
    const { repos, service } = couponScenario();
    await expect(service.removeCoupon(1)).rejects.toMatchObject({
      code: 'COUPON_NOT_APPLIED',
      status: 409,
    });
    expect(repos.carts.touch).not.toHaveBeenCalled();
  });

  it('refuses in a final state', async () => {
    const { service } = couponScenario({ status: 'abandoned', couponId: 9 });
    await expect(service.removeCoupon(1)).rejects.toMatchObject({ code: 'INVALID_CART_STATE' });
  });
});

describe('coupon kept below the minimum (RN-016)', () => {
  it('keeps the coupon when an item removal drops the subtotal under the minimum', async () => {
    const { repos, service } = build();
    repos.carts.lockById.mockResolvedValue(makeCart({ status: 'with_items', couponId: 9 }));
    repos.carts.findItem.mockResolvedValue(line(1));
    const remaining = details({
      cart: makeCart({ status: 'with_items', couponId: 9 }),
      items: [line(1, 500)],
      coupon: { id: 9, code: 'MIN200', type: 'percentage', value: 15 },
    });
    repos.carts.findDetails.mockResolvedValue(remaining);

    const view = await service.removeItem(1, 5);

    expect(repos.carts.setCoupon).not.toHaveBeenCalled();
    expect(view.coupon?.code).toBe('MIN200');
    expect(view).toMatchObject({ subtotalCents: 500, discountCents: 75, totalCents: 425 });
  });
});
