import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseEnvironment } from './database.factory.js';

const mocks = vi.hoisted(() => ({
  createPool: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('mysql2', () => ({ createPool: mocks.createPool }));
vi.mock('node:fs', () => ({ readFileSync: mocks.readFileSync }));

import { createDatabase } from './database.factory.js';

describe('createDatabase', () => {
  beforeEach(() => {
    mocks.createPool.mockReset();
    mocks.readFileSync.mockReset();
    mocks.createPool.mockReturnValue({ on: vi.fn() });
    mocks.readFileSync.mockReturnValue('test-ca');
  });

  it('loads the configured CA certificate for TLS connections', async () => {
    const environment: DatabaseEnvironment = {
      DB_HOST: 'example.mysql.rds.aliyuncs.com',
      DB_PORT: 3306,
      DB_NAME: 'qisi-easy',
      DB_USER: 'qisi_ai',
      DB_PASSWORD: 'test-only',
      DB_SSL: true,
      DB_SSL_CA_PATH: 'certs/ApsaraDB-CA-Chain.pem',
      DB_CONNECTION_LIMIT: 10,
    };

    const database = createDatabase(environment);

    expect(mocks.readFileSync).toHaveBeenCalledWith(
      resolve(process.cwd(), 'certs/ApsaraDB-CA-Chain.pem'),
      'utf8',
    );
    expect(mocks.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl: {
          ca: 'test-ca',
          rejectUnauthorized: true,
        },
      }),
    );

    await database.destroy();
  });
});
