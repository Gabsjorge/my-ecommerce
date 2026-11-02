import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../shared/errors';
import { parseOrThrow } from '../../shared/validation';
import { couponCodeSchema, normalizeCouponCode } from './coupon.code';

describe('normalizeCouponCode', () => {
  it('trims the ends and uppercases', () => {
    expect(normalizeCouponCode('  desc10 ')).toBe('DESC10');
    expect(normalizeCouponCode('Ui-Confirma10')).toBe('UI-CONFIRMA10');
  });
});

describe('couponCodeSchema', () => {
  it.each(['desc10', '  DESC10  ', 'zera-fixo', 'a_b', 'abc', 'A'.repeat(30)])(
    'accepts %j',
    (raw) => {
      expect(parseOrThrow(couponCodeSchema, raw)).toBe(raw.trim().toUpperCase());
    },
  );

  it.each([
    ['2 characters', 'ab'],
    ['31 characters', 'A'.repeat(31)],
    ['blank', '   '],
    ['empty', ''],
    ['inner space', 'DESC 10'],
    ['symbol', 'DESC@10'],
    ['accent', 'DESCÃO'],
    ['dot', 'DESC.10'],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseOrThrow(couponCodeSchema, raw)).toThrow(ValidationError);
  });

  it('measures the length after trimming', () => {
    expect(() => parseOrThrow(couponCodeSchema, ` ${'A'.repeat(31)} `)).toThrow(ValidationError);
    expect(parseOrThrow(couponCodeSchema, ` ${'A'.repeat(30)} `)).toBe('A'.repeat(30));
  });

  it.each([undefined, null, 10, {}])('rejects non-string %j', (raw) => {
    expect(() => parseOrThrow(couponCodeSchema, raw)).toThrow(ValidationError);
  });
});
