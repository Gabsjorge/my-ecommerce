export type CouponType = 'percentage' | 'fixed';

export interface Coupon {
  id: number;
  code: string;
  type: CouponType;
  value: number;
  minOrderCents: number;
  expiresAt: Date;
  usedAt: Date | null;
}
