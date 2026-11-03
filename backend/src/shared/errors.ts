export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input', details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests, try again later') {
    super('RATE_LIMITED', message, 429);
  }
}
