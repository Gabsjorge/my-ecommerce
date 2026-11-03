// Boundary values for RN-015 shared by unit and integration tests (all money in cents).
export interface PercentageCase {
  name: string;
  subtotalCents: number;
  percent: number;
  expectedDiscountCents: number;
}

export const PERCENTAGE_ROUNDING_CASES: PercentageCase[] = [
  {
    name: '15% of 99 rounds down (14.85 -> 14)',
    subtotalCents: 99,
    percent: 15,
    expectedDiscountCents: 14,
  },
  { name: '10% of 1 cent is zero', subtotalCents: 1, percent: 10, expectedDiscountCents: 0 },
  { name: '1% of 99 cents is zero', subtotalCents: 99, percent: 1, expectedDiscountCents: 0 },
  {
    name: '33% of 10001 rounds down (3300.33 -> 3300)',
    subtotalCents: 10001,
    percent: 33,
    expectedDiscountCents: 3300,
  },
  { name: '100% zeroes the total', subtotalCents: 8990, percent: 100, expectedDiscountCents: 8990 },
  {
    name: '100% at the int32 limit does not overflow',
    subtotalCents: 2147483647,
    percent: 100,
    expectedDiscountCents: 2147483647,
  },
  {
    name: '99% at the int32 limit rounds down',
    subtotalCents: 2147483647,
    percent: 99,
    expectedDiscountCents: 2126008810,
  },
];

export interface FixedCase {
  name: string;
  subtotalCents: number;
  valueCents: number;
  expectedDiscountCents: number;
}

export const FIXED_ROUNDING_CASES: FixedCase[] = [
  {
    name: 'fixed below subtotal',
    subtotalCents: 8990,
    valueCents: 2000,
    expectedDiscountCents: 2000,
  },
  {
    name: 'fixed equal to subtotal',
    subtotalCents: 2000,
    valueCents: 2000,
    expectedDiscountCents: 2000,
  },
  {
    name: 'fixed above subtotal is capped',
    subtotalCents: 1999,
    valueCents: 2000,
    expectedDiscountCents: 1999,
  },
  { name: 'fixed on empty subtotal', subtotalCents: 0, valueCents: 2000, expectedDiscountCents: 0 },
];
