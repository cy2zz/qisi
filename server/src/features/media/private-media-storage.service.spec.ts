import type { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { PrivateMediaStorageService } from './private-media-storage.service.js';

const temporaryRoots: string[] = [];

async function createStorage() {
  const root = await mkdtemp(join(tmpdir(), 'qisi-private-media-'));
  temporaryRoots.push(root);
  const config = { get: () => root } as unknown as ConfigService<AppEnvironment, true>;
  return { root, storage: new PrivateMediaStorageService(config) };
}

describe('PrivateMediaStorageService', () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it('stores only generated private filenames and removes their bytes', async () => {
    const { root, storage } = await createStorage();
    const bytes = Buffer.from([1, 2, 3]);

    const relativePath = await storage.write(bytes, 'image/png');

    expect(relativePath).toMatch(/^[0-9a-f-]{36}\.png$/);
    await expect(storage.read(relativePath)).resolves.toEqual(bytes);
    await expect(readFile(join(root, relativePath))).resolves.toEqual(bytes);
    await storage.remove(relativePath);
    await expect(storage.read(relativePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['../outside.png', '/tmp/outside.png', 'plain.png', 'bad\\path.png'])(
    'rejects non-generated private path %s',
    async (relativePath) => {
      const { storage } = await createStorage();
      expect(() => storage.read(relativePath)).toThrow('invalid private media path');
    },
  );
});
