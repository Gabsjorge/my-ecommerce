import { describe, expect, it } from 'vitest';
import { isExpired } from './cart.timeout';
import { CART_STATUSES } from './cart.types';

const last = new Date('2026-06-01T12:00:00.000Z');
const TIMEOUT_MS = 10_000;
const at = (offsetMs: number) => new Date(last.getTime() + offsetMs);

describe('isExpired', () => {
  it.each(['with_items', 'in_checkout'] as const)('%s expires only after the timeout', (status) => {
    expect(isExpired(status, last, at(TIMEOUT_MS - 1), TIMEOUT_MS)).toBe(false);
    expect(isExpired(status, last, at(TIMEOUT_MS), TIMEOUT_MS)).toBe(false);
    expect(isExpired(status, last, at(TIMEOUT_MS + 1), TIMEOUT_MS)).toBe(true);
  });

  it.each(CART_STATUSES.filter((s) => s !== 'with_items' && s !== 'in_checkout'))(
    '%s never expires',
    (status) => {
      expect(isExpired(status, last, at(TIMEOUT_MS * 100), TIMEOUT_MS)).toBe(false);
    },
  );

  it('does not expire when no time has passed', () => {
    expect(isExpired('with_items', last, last, TIMEOUT_MS)).toBe(false);
  });
});
