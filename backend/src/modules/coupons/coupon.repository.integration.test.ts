import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test-support/app';
import { createCleanup } from '../../test-support/cleanup';
import { createCoupon } from '../../test-support/factories';
import { CouponRepository } from './coupon.repository';

const { db, close } = createTestApp();
const cleanup = createCleanup();
const repository = new CouponRepository(db);

afterEach(() => cleanup.run(db));
afterAll(() => close());

describe('CouponRepository.findByCode (integration)', () => {
  it('returns the mapped coupon when the code exists', async () => {
    const created = await createCoupon(db, cleanup, {
      type: 'fixed',
      value: 2000,
      minOrderCents: 500,
    });
    expect(await repository.findByCode(created.code)).toEqual({
      id: created.id,
      code: created.code,
      type: 'fixed',
      value: 2000,
      minOrderCents: 500,
      expiresAt: created.expiresAt,
      usedAt: null,
    });
  });

  it('returns null when the code does not exist', async () => {
    expect(await repository.findByCode('NAO-EXISTE-XYZ')).toBeNull();
  });

  it('finds the seeded used coupon with usedAt filled', async () => {
    const coupon = await repository.findByCode('USADO10');
    expect(coupon?.usedAt).toBeInstanceOf(Date);
  });
});

describe('CouponRepository.lockById (integration)', () => {
  it('returns the coupon inside a transaction', async () => {
    const created = await createCoupon(db, cleanup);
    const locked = await db.transaction((tx) => new CouponRepository(tx).lockById(created.id));
    expect(locked?.code).toBe(created.code);
  });

  it('blocks a second transaction until the first one commits (RN-013)', async () => {
    const created = await createCoupon(db, cleanup);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstHasLock!: () => void;
    const firstLocked = new Promise<void>((resolve) => (firstHasLock = resolve));

    const first = db.transaction(async (tx) => {
      await new CouponRepository(tx).lockById(created.id);
      events.push('first locked');
      firstHasLock();
      await firstMayCommit;
      events.push('first commit');
    });

    await firstLocked;
    const second = db.transaction(async (tx) => {
      await new CouponRepository(tx).lockById(created.id);
      events.push('second locked');
    });

    // The second transaction must still be waiting for the row lock.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events).toEqual(['first locked']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first locked', 'first commit', 'second locked']);
  });

  it('returns null for an unknown id', async () => {
    const locked = await db.transaction((tx) => new CouponRepository(tx).lockById(2147483647));
    expect(locked).toBeNull();
  });
});

describe('CouponRepository.markUsed (integration)', () => {
  it('marks once; the second call affects no rows and keeps the first date (RN-013)', async () => {
    const created = await createCoupon(db, cleanup);
    const first = new Date('2030-01-01T00:00:00Z');
    const second = new Date('2031-01-01T00:00:00Z');

    expect(await repository.markUsed(created.id, first)).toBe(true);
    expect(await repository.markUsed(created.id, second)).toBe(false);
    expect((await repository.findByCode(created.code))?.usedAt).toEqual(first);
  });

  it('does not re-mark the seeded used coupon', async () => {
    const before = await repository.findByCode('USADO10');
    expect(await repository.markUsed(before!.id, new Date())).toBe(false);
    expect((await repository.findByCode('USADO10'))?.usedAt).toEqual(before!.usedAt);
  });
});
