import { z } from 'zod';

// RN-014: after normalization, 3 to 30 letters, digits, hyphen or underscore.
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;

// Only ASCII letters are uppercased: String.prototype.toUpperCase would map characters such as
// 'ſ', 'ı' and 'ß' to ASCII ('S', 'I', 'SS') and let non-ASCII input pass the format check.
export function normalizeCouponCode(raw: string): string {
  return raw.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

// Normalizes first, then validates the format; failures surface as VALIDATION_ERROR via parseOrThrow.
export const couponCodeSchema = z
  .string()
  .transform(normalizeCouponCode)
  .pipe(z.string().regex(COUPON_CODE_PATTERN, 'Invalid coupon code'));
