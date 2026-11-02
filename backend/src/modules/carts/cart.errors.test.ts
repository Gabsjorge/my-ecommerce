import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errorHandler } from '../../shared/error-handler.middleware';
import { AppError } from '../../shared/errors';
import { InvalidCartStateError } from './cart.errors';
import { CART_STATUSES } from './cart.types';

describe('CART_STATUSES', () => {
  it('lists exactly the five states of the diagram', () => {
    expect([...CART_STATUSES]).toEqual([
      'empty',
      'with_items',
      'in_checkout',
      'order_created',
      'abandoned',
    ]);
  });
});

describe('InvalidCartStateError', () => {
  it('is a 409 AppError that names the operation and the state', () => {
    const err = new InvalidCartStateError('CHECKOUT', 'empty');
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('INVALID_CART_STATE');
    expect(err.status).toBe(409);
    expect(err.message).toBe("Operation CHECKOUT is not allowed when the cart is in state 'empty'");
    expect(err.details).toEqual({ operation: 'CHECKOUT', status: 'empty' });
  });

  it('is serialized by the error handler with the standard envelope', () => {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    errorHandler(
      new InvalidCartStateError('ABANDON', 'empty'),
      {} as Request,
      res as unknown as Response,
      (() => {}) as NextFunction,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'INVALID_CART_STATE',
        message: "Operation ABANDON is not allowed when the cart is in state 'empty'",
        details: { operation: 'ABANDON', status: 'empty' },
      },
    });
  });
});
