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

export interface CouponRepositoryPort {
  // Expects the code already normalized (upper case, RN-014).
  findByCode(code: string): Promise<Coupon | null>;
  // Locks the row (FOR UPDATE); must run inside a transaction.
  lockById(id: number): Promise<Coupon | null>;
  // Conditional on `used_at IS NULL`; false when the coupon was already used (RN-013).
  markUsed(id: number, at: Date): Promise<boolean>;
}
