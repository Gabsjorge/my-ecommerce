import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from './errors';
import { parseOrThrow, positiveIntParam } from './validation';

describe('positiveIntParam', () => {
  it.each([
    ['1', 1],
    [1, 1],
    ['2147483647', 2147483647],
    [2147483647, 2147483647],
  ])('accepts %j', (input, expected) => {
    expect(positiveIntParam.parse(input)).toBe(expected);
  });

  it.each([
    0,
    '0',
    -1,
    '-1',
    1.5,
    '1.5',
    'abc',
    '',
    ' 1',
    '2147483648',
    2147483648,
    null,
    undefined,
  ])('rejects %j', (input) => {
    expect(positiveIntParam.safeParse(input).success).toBe(false);
  });
});

describe('parseOrThrow', () => {
  const schema = z.object({ quantity: positiveIntParam });

  it('returns the parsed data', () => {
    expect(parseOrThrow(schema, { quantity: '3' })).toEqual({ quantity: 3 });
  });

  it('throws ValidationError with path/message details and no received values', () => {
    let error: unknown;
    try {
      parseOrThrow(schema, { quantity: 'secret-value' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ValidationError);
    const { status, code, details } = error as ValidationError;
    expect(status).toBe(400);
    expect(code).toBe('VALIDATION_ERROR');
    expect(details).toEqual([expect.objectContaining({ path: 'quantity' })]);
    expect(JSON.stringify(details)).not.toContain('secret-value');
  });

  it('rejects a missing required field', () => {
    expect(() => parseOrThrow(schema, {})).toThrow(ValidationError);
  });
});
