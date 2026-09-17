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

  it('accepts the RDS database name and CA path when TLS is enabled', () => {
    const env = parseEnvironment({
      NODE_ENV: 'production',
      DB_NAME: 'qisi-easy',
      DB_PASSWORD: 'test-only',
      DB_SSL: 'true',
      DB_SSL_CA_PATH: 'certs/ApsaraDB-CA-Chain.pem',
    });

    expect(env.DB_NAME).toBe('qisi-easy');
    expect(env.DB_SSL_CA_PATH).toBe('certs/ApsaraDB-CA-Chain.pem');
  });

  it('uses the bundled CA certificate path by default', () => {
    const env = parseEnvironment({ DB_SSL: 'true' });

    expect(env.DB_SSL_CA_PATH).toBe('certs/ApsaraDB-CA-Chain.pem');
  });
});
