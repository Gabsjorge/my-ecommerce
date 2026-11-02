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
