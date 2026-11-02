import { computeTotals } from './cart.pricing';
import { InvalidCartStateError, CartNotFoundError } from './cart.errors';
import type { Operation } from './cart.state';
import { isExpired } from './cart.timeout';
import type { CartDetails, CartRecord, CartRepositoryPort, CartView, Clock } from './cart.types';
import type { TxRepositories, UnitOfWork } from './cart.unit-of-work';

export interface CartServiceDeps {
  // Non-transactional repository, used for creation and lock-free reads.
  carts: CartRepositoryPort;
  unitOfWork: UnitOfWork;
  clock: Clock;
  inactivityTimeoutMs: number;
}

interface LockedCart {
  repos: TxRepositories;
  cart: CartRecord;
  now: Date;
}

// The commit must happen before the timeout error is raised, otherwise the rollback would
// discard the 'abandoned' status (RN-020).
type LockOutcome<T> = { kind: 'abandoned' } | { kind: 'ok'; value: T };

export function toCartView({ cart, items, coupon }: CartDetails): CartView {
  const totals = computeTotals(items, coupon);
  return {
    id: cart.id,
    status: cart.status,
    items: items.map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      subtotalCents: item.unitPriceCents * item.quantity,
    })),
    coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
    ...totals,
  };
}

export class CartService {
  constructor(private readonly deps: CartServiceDeps) {}

  async createCart(): Promise<CartView> {
    const cart = await this.deps.carts.create(this.deps.clock());
    return toCartView({ cart, items: [], coupon: null });
  }

  // Applies the timeout on access but never renews the inactivity counter (RN-020).
  async getCart(cartId: number): Promise<CartView> {
    const { carts, clock, inactivityTimeoutMs } = this.deps;
    await carts.abandonIfExpired(cartId, new Date(clock().getTime() - inactivityTimeoutMs));
    const details = await carts.findDetails(cartId);
    if (!details) throw new CartNotFoundError();
    return toCartView(details);
  }

  // Runs a write under the cart row lock (RN-021, section 5.3). Order of checks: cart exists,
  // timeout, then whatever `work` validates (state and domain rules).
  protected async withCartLock<T>(
    cartId: number,
    operation: Operation,
    work: (locked: LockedCart) => Promise<T>,
  ): Promise<T> {
    const outcome = await this.deps.unitOfWork.run<LockOutcome<T>>(async (repos) => {
      const cart = await repos.carts.lockById(cartId);
      if (!cart) throw new CartNotFoundError();
      const now = this.deps.clock();
      if (isExpired(cart.status, cart.lastActivityAt, now, this.deps.inactivityTimeoutMs)) {
        await repos.carts.setStatus(cartId, 'abandoned');
        return { kind: 'abandoned' };
      }
      return { kind: 'ok', value: await work({ repos, cart, now }) };
    });
    if (outcome.kind === 'abandoned') throw new InvalidCartStateError(operation, 'abandoned');
    return outcome.value;
  }

  // Registers the successful write and returns the resulting view.
  protected async finishWrite({ repos, cart, now }: LockedCart): Promise<CartView> {
    await repos.carts.touch(cart.id, now);
    const details = await repos.carts.findDetails(cart.id);
    if (!details) throw new CartNotFoundError();
    return toCartView(details);
  }
}
