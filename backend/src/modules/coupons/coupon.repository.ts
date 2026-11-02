import { and, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { coupons } from '../../db/schema';
import type { Coupon, CouponRepositoryPort, CouponType } from './coupon.types';

type CouponRow = typeof coupons.$inferSelect;

function toCoupon(row: CouponRow): Coupon {
  return {
    id: row.id,
    code: row.code,
    type: row.type as CouponType,
    value: row.value,
    minOrderCents: row.minOrderCents,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
  };
}

export class CouponRepository implements CouponRepositoryPort {
  constructor(private readonly db: Executor) {}

  async findByCode(code: string): Promise<Coupon | null> {
    const [row] = await this.db.select().from(coupons).where(eq(coupons.code, code));
    return row ? toCoupon(row) : null;
  }

  async lockById(id: number): Promise<Coupon | null> {
    const [row] = await this.db.select().from(coupons).where(eq(coupons.id, id)).for('update');
    return row ? toCoupon(row) : null;
  }

  async markUsed(id: number, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(coupons)
      .set({ usedAt: at })
      .where(and(eq(coupons.id, id), isNull(coupons.usedAt)))
      .returning({ id: coupons.id });
    return updated.length > 0;
  }
}
