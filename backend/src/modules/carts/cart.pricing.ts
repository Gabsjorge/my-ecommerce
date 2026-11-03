export interface PricedLine {
  unitPriceCents: number;
  quantity: number;
}

export interface DiscountRule {
  type: 'percentage' | 'fixed';
  value: number;
}

export interface CartTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

// Largest value the int32 total columns can hold; above it the order insert would fail with a 500.
export const MAX_CART_SUBTOTAL_CENTS = 2_147_483_647;

// Sum of frozen unit price times quantity (RN-004, RN-015).
export function subtotalCents(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

// Percentage: floor(subtotal * value / 100). Fixed: min(value, subtotal). Never above the subtotal (RN-015).
export function discountCents(coupon: DiscountRule | null, subtotal: number): number {
  if (!coupon) return 0;
  if (coupon.type === 'percentage') return Math.floor((subtotal * coupon.value) / 100);
  return Math.min(coupon.value, subtotal);
}

export function computeTotals(
  lines: readonly PricedLine[],
  coupon: DiscountRule | null,
): CartTotals {
  const subtotal = subtotalCents(lines);
  const discount = discountCents(coupon, subtotal);
  return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount };
}
