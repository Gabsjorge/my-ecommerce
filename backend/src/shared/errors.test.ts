import { describe, expect, it } from 'vitest';
import { AppError, NotFoundError, ValidationError } from './errors';

describe('errors', () => {
  it('ValidationError is a 400 VALIDATION_ERROR carrying details', () => {
    const error = new ValidationError('bad', [{ path: 'a', message: 'x' }]);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(400);
    expect(error.details).toEqual([{ path: 'a', message: 'x' }]);
  });

  it('details are optional', () => {
    expect(new NotFoundError().details).toBeUndefined();
    expect(new ValidationError().details).toBeUndefined();
  });
});
