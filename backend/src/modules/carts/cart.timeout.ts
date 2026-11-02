import type { CartStatus } from './cart.types';

const ACTIVE_STATUSES: readonly CartStatus[] = ['with_items', 'in_checkout'];

// Inactive for strictly longer than the timeout, and only while the cart is active (RN-020).
export function isExpired(
  status: CartStatus,
  lastActivityAt: Date,
  now: Date,
  timeoutMs: number,
): boolean {
  return ACTIVE_STATUSES.includes(status) && now.getTime() - lastActivityAt.getTime() > timeoutMs;
}
