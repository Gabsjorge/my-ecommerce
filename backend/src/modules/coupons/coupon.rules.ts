import {
  CouponAlreadyAppliedError,
  CouponAlreadyUsedError,
  CouponExpiredError,
  CouponMinOrderNotMetError,
  CouponNotFoundError,
} from './coupon.errors';
import type { Coupon } from './coupon.types';

interface RevalidateInput {
  coupon: Coupon | null;
  subtotalCents: number;
  now: Date;
}

interface ApplyInput extends RevalidateInput {
  cartCouponId: number | null;
}

// Checks 2, 4, 5 and 6 of RN-010, shared by apply and confirm (RN-011). The format check (1) lives in the schema.
// Asserts the coupon exists, so callers can use it afterwards.
function assertUsable(
  coupon: Coupon | null,
  subtotalCents: number,
  now: Date,
): asserts coupon is Coupon {
  if (!coupon) throw new CouponNotFoundError();
  // Valid up to and including the expiry instant.
  if (coupon.expiresAt.getTime() < now.getTime()) throw new CouponExpiredError();
  if (coupon.usedAt !== null) throw new CouponAlreadyUsedError();
  if (subtotalCents < coupon.minOrderCents) throw new CouponMinOrderNotMetError();
}

// RN-010, in order: exists, cart has no coupon, not expired, not used, minimum met. Returns the validated coupon.
export function validateOnApply(input: ApplyInput): Coupon {
  if (!input.coupon) throw new CouponNotFoundError();
  if (input.cartCouponId !== null) throw new CouponAlreadyAppliedError();
  assertUsable(input.coupon, input.subtotalCents, input.now);
  return input.coupon;
}

// RN-011: existence, expiry, usage and minimum are checked again against the current state.
export function revalidateOnConfirm({ coupon, subtotalCents, now }: RevalidateInput): void {
  assertUsable(coupon, subtotalCents, now);
}
