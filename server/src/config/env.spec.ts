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

  it('accepts an OpenAI-compatible model endpoint without exposing the key to defaults', () => {
    const env = parseEnvironment({
      AI_API_KEY: 'test-only-key',
      AI_BASE_URL: 'https://provider.example/v1',
      AI_MODEL: 'test-model',
    });

    expect(env.AI_BASE_URL).toBe('https://provider.example/v1');
    expect(env.AI_MODEL).toBe('test-model');
    expect(env.AI_API_KEY).toBe('test-only-key');
    expect(parseEnvironment({}).AI_API_KEY).toBeUndefined();
  });

  it('requires the Youdao speech key and secret to be configured together', () => {
    expect(() => parseEnvironment({ YOUDAO_SPEECH_APP_KEY: 'test-app-key' })).toThrow(
      'YOUDAO_SPEECH_APP_KEY and YOUDAO_SPEECH_APP_SECRET must be configured together',
    );
    expect(() => parseEnvironment({ YOUDAO_SPEECH_APP_SECRET: 'test-app-secret' })).toThrow(
      'YOUDAO_SPEECH_APP_KEY and YOUDAO_SPEECH_APP_SECRET must be configured together',
    );
  });

  it('accepts a complete Youdao speech configuration', () => {
    const env = parseEnvironment({
      YOUDAO_SPEECH_APP_KEY: 'test-app-key',
      YOUDAO_SPEECH_APP_SECRET: 'test-app-secret',
    });

    expect(env.YOUDAO_SPEECH_APP_KEY).toBe('test-app-key');
    expect(env.YOUDAO_SPEECH_APP_SECRET).toBe('test-app-secret');
    expect(env.YOUDAO_SPEECH_TIMEOUT_MS).toBe(25_000);
  });
});
