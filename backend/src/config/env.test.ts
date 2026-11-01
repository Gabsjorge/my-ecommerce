import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const validEnv = {
  NODE_ENV: 'test',
  BACKEND_PORT: '3000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
};

describe('parseEnv', () => {
  it('accepts a valid environment', () => {
    const env = parseEnv(validEnv);
    expect(env).toEqual({
      NODE_ENV: 'test',
      BACKEND_PORT: 3000,
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    });
  });

  it('fails when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('fails when BACKEND_PORT is not a number', () => {
    expect(() => parseEnv({ ...validEnv, BACKEND_PORT: 'abc' })).toThrow(/BACKEND_PORT/);
  });

  it('applies defaults for NODE_ENV and BACKEND_PORT', () => {
    const env = parseEnv({ DATABASE_URL: validEnv.DATABASE_URL });
    expect(env.NODE_ENV).toBe('development');
    expect(env.BACKEND_PORT).toBe(3000);
  });
});
