import { z } from 'zod';

// RN-014: after normalization, 3 to 30 letters, digits, hyphen or underscore.
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// Normalizes first, then validates the format; failures surface as VALIDATION_ERROR via parseOrThrow.
export const couponCodeSchema = z
  .string()
  .transform(normalizeCouponCode)
  .pipe(z.string().regex(COUPON_CODE_PATTERN, 'Invalid coupon code'));
