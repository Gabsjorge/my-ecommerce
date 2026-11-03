import { describe, expect, it } from 'vitest';
import { parseOrThrow } from '../../shared/validation';
import {
  addItemBodySchema,
  applyCouponBodySchema,
  cartItemParamsSchema,
  cartParamsSchema,
  updateItemBodySchema,
} from './cart.schemas';

const invalid = { code: 'VALIDATION_ERROR', status: 400 };

describe('cartParamsSchema / cartItemParamsSchema', () => {
  it('parses positive integer path params', () => {
    expect(parseOrThrow(cartParamsSchema, { cartId: '12' })).toEqual({ cartId: 12 });
    expect(parseOrThrow(cartItemParamsSchema, { cartId: '1', productId: '2147483647' })).toEqual({
      cartId: 1,
      productId: 2147483647,
    });
  });

  it.each(['0', '-1', '1.5', 'abc', '', '2147483648', '1e3'])('rejects cartId %j', (cartId) => {
    expect(() => parseOrThrow(cartParamsSchema, { cartId })).toThrow(
      expect.objectContaining(invalid),
    );
  });

  it('rejects an invalid productId', () => {
    expect(() => parseOrThrow(cartItemParamsSchema, { cartId: '1', productId: '0' })).toThrow(
      expect.objectContaining(invalid),
    );
  });

  it.each(['-1', '1.5', 'abc', '', '2147483648', '99999999999999999999'])(
    'rejects productId %j in the path (DELETE/PATCH item)',
    (productId) => {
      expect(() => parseOrThrow(cartItemParamsSchema, { cartId: '1', productId })).toThrow(
        expect.objectContaining(invalid),
      );
    },
  );
});

describe('addItemBodySchema', () => {
  it('accepts integers within range', () => {
    expect(parseOrThrow(addItemBodySchema, { productId: 3, quantity: 2147483647 })).toEqual({
      productId: 3,
      quantity: 2147483647,
    });
  });

  it.each([
    ['zero quantity', { productId: 1, quantity: 0 }],
    ['negative quantity', { productId: 1, quantity: -1 }],
    ['decimal quantity', { productId: 1, quantity: 1.5 }],
    ['string quantity', { productId: 1, quantity: '2' }],
    ['null quantity', { productId: 1, quantity: null }],
    ['missing quantity', { productId: 1 }],
    ['quantity above int32', { productId: 1, quantity: 2147483648 }],
    ['zero productId', { productId: 0, quantity: 1 }],
    ['decimal productId', { productId: 1.2, quantity: 1 }],
    ['string productId', { productId: '1', quantity: 1 }],
    ['productId above int32', { productId: 2147483648, quantity: 1 }],
    ['missing productId', { quantity: 1 }],
    ['empty object', {}],
    ['absent body', undefined],
    ['non-object body', 'x'],
  ])('rejects %s', (_label, body) => {
    expect(() => parseOrThrow(addItemBodySchema, body)).toThrow(expect.objectContaining(invalid));
  });
});

describe('updateItemBodySchema', () => {
  it('accepts a positive integer', () => {
    expect(parseOrThrow(updateItemBodySchema, { quantity: 4 })).toEqual({ quantity: 4 });
  });

  it.each([0, -3, 2.5, '3', null, undefined, 2147483648])('rejects quantity %j', (quantity) => {
    expect(() => parseOrThrow(updateItemBodySchema, { quantity })).toThrow(
      expect.objectContaining(invalid),
    );
  });
});

describe('applyCouponBodySchema', () => {
  it('normalizes the code: trim and upper case (RN-014)', () => {
    expect(parseOrThrow(applyCouponBodySchema, { code: '  desc10 ' })).toEqual({ code: 'DESC10' });
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'A'.repeat(31)],
    ['bad characters', 'DESC 10'],
    ['accents', 'DESCÃO'],
    ['blank', '   '],
  ])('rejects a code that is %s', (_label, code) => {
    expect(() => parseOrThrow(applyCouponBodySchema, { code })).toThrow(
      expect.objectContaining(invalid),
    );
  });

  it.each([{}, { code: 123 }, { code: null }, undefined])('rejects body %j', (body) => {
    expect(() => parseOrThrow(applyCouponBodySchema, body)).toThrow(
      expect.objectContaining(invalid),
    );
  });

  it('accepts the length limits and allowed symbols', () => {
    expect(parseOrThrow(applyCouponBodySchema, { code: 'a-_' }).code).toBe('A-_');
    expect(parseOrThrow(applyCouponBodySchema, { code: 'a'.repeat(30) }).code).toHaveLength(30);
  });
});
