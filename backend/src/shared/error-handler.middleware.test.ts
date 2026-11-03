import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, NotFoundError } from './errors';
import { errorHandler } from './error-handler.middleware';

// Calls the handler directly with a fake response (no sockets needed).
function handle(err: unknown) {
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
  errorHandler(err, {} as Request, res as unknown as Response, (() => {}) as NextFunction);
  return res;
}

// Runs the real express.json() parser over an in-memory request and returns the error it raises.
function parseBody(raw: string): Promise<unknown> {
  const req = Object.assign(Readable.from([Buffer.from(raw)]), {
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(raw)),
    },
  });
  return new Promise((resolve) => {
    express.json({ limit: '10kb' })(req as unknown as Request, {} as Response, (err?: unknown) =>
      resolve(err),
    );
  });
}

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes an AppError without details', () => {
    const res = handle(new AppError('SOME_CODE', 'some message', 409));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: { code: 'SOME_CODE', message: 'some message' } });
  });

  it('serializes an AppError with details', () => {
    const res = handle(new AppError('SOME_CODE', 'some message', 409, { items: [1] }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'SOME_CODE', message: 'some message', details: { items: [1] } },
    });
  });

  it('delegates to Express when headers were already sent', () => {
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() };
    const err = new Error('late failure');
    errorHandler(err, {} as Request, res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('serializes NotFoundError as 404', () => {
    const res = handle(new NotFoundError('nope'));
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'nope' } });
  });

  it('maps a malformed JSON body (real express.json error) to 400 VALIDATION_ERROR', async () => {
    const res = handle(await parseBody('{"a":'));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' },
    });
  });

  it('maps a body above 10kb (real express.json error) to 413 VALIDATION_ERROR', async () => {
    const res = handle(await parseBody(JSON.stringify({ big: 'x'.repeat(11 * 1024) })));
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body too large' },
    });
  });

  it('returns 500 INTERNAL_ERROR without leaking details for unexpected errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = handle(new Error('secret internal detail'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(spy).toHaveBeenCalled();
  });
});
