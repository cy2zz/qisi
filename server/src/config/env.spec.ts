import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env.js';

describe('parseEnvironment', () => {
  it('uses safe local defaults', () => {
    const env = parseEnvironment({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.DB_HOST).toBe('127.0.0.1');
    expect(env.DB_SSL).toBe(false);
  });

  it('requires explicit production database credentials', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow();
  });
});
