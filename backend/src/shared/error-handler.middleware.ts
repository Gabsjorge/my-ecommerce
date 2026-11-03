import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError } from './errors';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found'));
};

// body-parser errors carry a `type`; map the client-caused ones to VALIDATION_ERROR.
function bodyParserStatus(err: unknown): 400 | 413 | undefined {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') return 400;
  if (type === 'entity.too.large') return 413;
  return undefined;
}

// Drizzle query errors embed the SQL and its parameters in the message; log only the first line.
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Non-Error value thrown';
  const code = (err as { code?: unknown }).code;
  const suffix = typeof code === 'string' ? ` [${code}]` : '';
  return `${err.name}: ${err.message.split('\n')[0]}${suffix}`;
}

// Express recognizes error handlers by their 4 arguments.
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Headers already sent: let Express close the connection instead of writing twice.
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof AppError) {
    const body: { code: string; message: string; details?: unknown } = {
      code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.status).json({ error: body });
    return;
  }
  const status = bodyParserStatus(err);
  if (status !== undefined) {
    // Fixed messages: never echo the offending payload.
    const message = status === 413 ? 'Request body too large' : 'Malformed JSON body';
    res.status(status).json({ error: { code: 'VALIDATION_ERROR', message } });
    return;
  }
  // Log the detail server-side only; never leak it to the client.
  console.error('Unhandled error:', describeError(err));
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
