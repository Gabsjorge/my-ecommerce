import { describe, expect, it } from 'vitest';
import { InvalidCartStateError } from './cart.errors';
import { OPERATIONS, assertAllowed, nextState } from './cart.state';
import type { Operation } from './cart.state';
import { CART_STATUSES } from './cart.types';
import type { CartStatus } from './cart.types';

// Expected allowed pairs, written independently from the implementation (diagram + FRD section 6).
const ALLOWED: Record<Operation, Partial<Record<CartStatus, CartStatus>>> = {
  ADD_ITEM: { empty: 'with_items', with_items: 'with_items' },
  UPDATE_ITEM: { with_items: 'with_items' },
  REMOVE_ITEM: { with_items: 'with_items' },
  APPLY_COUPON: { with_items: 'with_items', in_checkout: 'in_checkout' },
  REMOVE_COUPON: { with_items: 'with_items', in_checkout: 'in_checkout' },
  CHECKOUT: { with_items: 'in_checkout' },
  EDIT: { in_checkout: 'with_items' },
  CONFIRM: { in_checkout: 'order_created' },
  ABANDON: { with_items: 'abandoned', in_checkout: 'abandoned' },
  TIMEOUT: { with_items: 'abandoned', in_checkout: 'abandoned' },
};

const ctxFor = (op: Operation) => (op === 'REMOVE_ITEM' ? { remainingItems: 2 } : {});

describe('operations', () => {
  it('lists exactly the ten operations of the transition table', () => {
    expect([...OPERATIONS]).toEqual(Object.keys(ALLOWED));
  });
});

describe('nextState: diagram transitions', () => {
  it.each([
    ['ADD_ITEM', 'empty', 'with_items'],
    ['CHECKOUT', 'with_items', 'in_checkout'],
    ['EDIT', 'in_checkout', 'with_items'],
    ['CONFIRM', 'in_checkout', 'order_created'],
    ['ABANDON', 'with_items', 'abandoned'],
    ['ABANDON', 'in_checkout', 'abandoned'],
    ['TIMEOUT', 'with_items', 'abandoned'],
    ['TIMEOUT', 'in_checkout', 'abandoned'],
  ] as const)('%s from %s goes to %s without clearing the coupon', (op, from, to) => {
    expect(nextState(op, from)).toEqual({ to, clearCoupon: false });
  });

  it('removing the last item goes back to empty and clears the coupon (RN-016)', () => {
    expect(nextState('REMOVE_ITEM', 'with_items', { remainingItems: 0 })).toEqual({
      to: 'empty',
      clearCoupon: true,
    });
  });
});

describe('nextState: same-state operations', () => {
  it.each([
    ['ADD_ITEM', 'with_items'],
    ['UPDATE_ITEM', 'with_items'],
    ['APPLY_COUPON', 'with_items'],
    ['REMOVE_COUPON', 'with_items'],
    ['APPLY_COUPON', 'in_checkout'],
    ['REMOVE_COUPON', 'in_checkout'],
  ] as const)('%s keeps %s', (op, state) => {
    expect(nextState(op, state)).toEqual({ to: state, clearCoupon: false });
  });

  it('removing an item with items remaining stays with_items and keeps the coupon', () => {
    expect(nextState('REMOVE_ITEM', 'with_items', { remainingItems: 1 })).toEqual({
      to: 'with_items',
      clearCoupon: false,
    });
  });

  it('EDIT leaves the coupon untouched', () => {
    expect(nextState('EDIT', 'in_checkout').clearCoupon).toBe(false);
  });
});

describe('full matrix: every operation x every state', () => {
  const pairs = OPERATIONS.flatMap((op) => CART_STATUSES.map((from) => [op, from] as const));

  it('covers 50 combinations', () => {
    expect(pairs).toHaveLength(50);
  });

  it.each(pairs)('%s in %s', (op, from) => {
    const expected = ALLOWED[op][from];
    if (expected === undefined) {
      expect(() => nextState(op, from, ctxFor(op))).toThrow(InvalidCartStateError);
      expect(() => assertAllowed(op, from)).toThrow(InvalidCartStateError);
      try {
        nextState(op, from, ctxFor(op));
      } catch (err) {
        expect(err).toMatchObject({
          code: 'INVALID_CART_STATE',
          status: 409,
          details: { operation: op, status: from },
        });
        expect((err as Error).message).toContain(op);
        expect((err as Error).message).toContain(from);
      }
    } else {
      expect(nextState(op, from, ctxFor(op)).to).toBe(expected);
      expect(() => assertAllowed(op, from)).not.toThrow();
    }
  });
});

describe('forbidden transitions called out by the spec', () => {
  it.each(OPERATIONS)('final state order_created rejects %s (RN-022)', (op) => {
    expect(() => nextState(op, 'order_created', ctxFor(op))).toThrow(InvalidCartStateError);
  });

  it.each(OPERATIONS)('final state abandoned rejects %s (RN-018)', (op) => {
    expect(() => nextState(op, 'abandoned', ctxFor(op))).toThrow(InvalidCartStateError);
  });

  it('an empty cart cannot be abandoned (RN-019)', () => {
    expect(() => nextState('ABANDON', 'empty')).toThrow(InvalidCartStateError);
  });

  it('an empty cart cannot receive a coupon (RN-010)', () => {
    expect(() => nextState('APPLY_COUPON', 'empty')).toThrow(InvalidCartStateError);
  });

  it('items are locked in in_checkout (RN-018)', () => {
    for (const op of ['ADD_ITEM', 'UPDATE_ITEM', 'REMOVE_ITEM'] as const) {
      expect(() => nextState(op, 'in_checkout', ctxFor(op))).toThrow(InvalidCartStateError);
    }
  });
});

describe('REMOVE_ITEM context', () => {
  it.each([undefined, -1, 1.5, Number.NaN])(
    'rejects remainingItems=%s as a programming error',
    (n) => {
      const call = () => nextState('REMOVE_ITEM', 'with_items', { remainingItems: n });
      expect(call).toThrow('remainingItems');
      expect(call).not.toThrow(InvalidCartStateError);
    },
  );

  it('reports the state error before validating the context', () => {
    expect(() => nextState('REMOVE_ITEM', 'empty')).toThrow(InvalidCartStateError);
  });
});
