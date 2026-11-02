import { InvalidCartStateError } from './cart.errors';
import type { CartStatus } from './cart.types';

export const OPERATIONS = [
  'ADD_ITEM',
  'UPDATE_ITEM',
  'REMOVE_ITEM',
  'APPLY_COUPON',
  'REMOVE_COUPON',
  'CHECKOUT',
  'EDIT',
  'CONFIRM',
  'ABANDON',
  'TIMEOUT',
] as const;

export type Operation = (typeof OPERATIONS)[number];

export interface TransitionContext {
  // Items left in the cart after the removal; required by REMOVE_ITEM only.
  remainingItems?: number;
}

export interface Transition {
  to: CartStatus;
  clearCoupon: boolean;
}

// Single source of truth: any (operation, state) pair absent here is forbidden.
// order_created and abandoned are final and never appear as a source state.
const TRANSITIONS: Record<Operation, Partial<Record<CartStatus, CartStatus>>> = {
  ADD_ITEM: { empty: 'with_items', with_items: 'with_items' },
  UPDATE_ITEM: { with_items: 'with_items' },
  // Default destination; the real one depends on the remaining items (see nextState).
  REMOVE_ITEM: { with_items: 'with_items' },
  APPLY_COUPON: { with_items: 'with_items', in_checkout: 'in_checkout' },
  REMOVE_COUPON: { with_items: 'with_items', in_checkout: 'in_checkout' },
  CHECKOUT: { with_items: 'in_checkout' },
  EDIT: { in_checkout: 'with_items' },
  CONFIRM: { in_checkout: 'order_created' },
  ABANDON: { with_items: 'abandoned', in_checkout: 'abandoned' },
  TIMEOUT: { with_items: 'abandoned', in_checkout: 'abandoned' },
};

function destination(operation: Operation, from: CartStatus): CartStatus {
  const to = TRANSITIONS[operation][from];
  if (to === undefined) throw new InvalidCartStateError(operation, from);
  return to;
}

export function assertAllowed(operation: Operation, from: CartStatus): void {
  destination(operation, from);
}

// Validates and resolves a transition without mutating anything (RN-016, RN-018, RN-019, RN-022).
export function nextState(
  operation: Operation,
  from: CartStatus,
  ctx: TransitionContext = {},
): Transition {
  const to = destination(operation, from);
  if (operation !== 'REMOVE_ITEM') return { to, clearCoupon: false };

  const { remainingItems } = ctx;
  if (remainingItems === undefined || !Number.isInteger(remainingItems) || remainingItems < 0) {
    throw new Error('REMOVE_ITEM requires remainingItems as a non-negative integer');
  }
  // Removing the last item empties the cart and drops the coupon (RN-016).
  return remainingItems > 0 ? { to, clearCoupon: false } : { to: 'empty', clearCoupon: true };
}
