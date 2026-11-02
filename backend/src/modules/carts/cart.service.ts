import { computeTotals } from './cart.pricing';
import { ProductNotFoundError } from '../products/product.errors';
import {
  CartItemNotFoundError,
  CartNotFoundError,
  InsufficientStockError,
  InvalidCartStateError,
} from './cart.errors';
import { assertAllowed, nextState } from './cart.state';
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

  // RF-003: a new product creates a line with the current (then frozen) price; a repeated one sums (RN-003, RN-004).
  addItem(cartId: number, productId: number, quantity: number): Promise<CartView> {
    return this.withCartLock(cartId, 'ADD_ITEM', async (locked) => {
      const { repos, cart } = locked;
      const { to } = nextState('ADD_ITEM', cart.status);
      const product = await repos.products.findById(productId);
      if (!product) throw new ProductNotFoundError();

      const line = await repos.carts.findItem(cart.id, productId);
      const requested = (line?.quantity ?? 0) + quantity;
      // Informative check only; the definitive one happens on confirmation (RN-005, RN-006).
      if (requested > product.stock) {
        throw new InsufficientStockError([{ productId, requested, available: product.stock }]);
      }

      if (line) await repos.carts.updateQuantity(cart.id, productId, requested);
      else await repos.carts.insertItem(cart.id, productId, quantity, product.priceCents);
      if (to !== cart.status) await repos.carts.setStatus(cart.id, to);
      return this.finishWrite(locked);
    });
  }

  // RF-004: replaces the quantity of an existing line (RN-002, RN-005).
  updateItemQuantity(cartId: number, productId: number, quantity: number): Promise<CartView> {
    return this.withCartLock(cartId, 'UPDATE_ITEM', async (locked) => {
      const { repos, cart } = locked;
      assertAllowed('UPDATE_ITEM', cart.status);
      const line = await repos.carts.findItem(cart.id, productId);
      if (!line) throw new CartItemNotFoundError();
      const product = await repos.products.findById(productId);
      if (!product) throw new ProductNotFoundError();
      if (quantity > product.stock) {
        throw new InsufficientStockError([
          { productId, requested: quantity, available: product.stock },
        ]);
      }

      await repos.carts.updateQuantity(cart.id, productId, quantity);
      return this.finishWrite(locked);
    });
  }

  // RF-005: removing the last item empties the cart and drops the coupon (RN-016).
  removeItem(cartId: number, productId: number): Promise<CartView> {
    return this.withCartLock(cartId, 'REMOVE_ITEM', async (locked) => {
      const { repos, cart } = locked;
      assertAllowed('REMOVE_ITEM', cart.status);
      const line = await repos.carts.findItem(cart.id, productId);
      if (!line) throw new CartItemNotFoundError();

      await repos.carts.deleteItem(cart.id, productId);
      const remaining = await repos.carts.findDetails(cart.id);
      const { to, clearCoupon } = nextState('REMOVE_ITEM', cart.status, {
        remainingItems: remaining?.items.length ?? 0,
      });
      if (to !== cart.status) await repos.carts.setStatus(cart.id, to);
      if (clearCoupon) await repos.carts.setCoupon(cart.id, null);
      return this.finishWrite(locked);
    });
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
