import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppEnvironment } from '../../config/env.js';

const extensionByMime: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class PrivateMediaStorageService {
  private readonly root: string;

  constructor(@Inject(ConfigService) config: ConfigService<AppEnvironment, true>) {
    this.root = resolve(config.get('MEDIA_STORAGE_ROOT', { infer: true }));
  }

  async write(bytes: Buffer, mime: string) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const relativePath = `${randomUUID()}${extensionByMime[mime] ?? ''}`;
    await writeFile(resolve(this.root, relativePath), bytes, { mode: 0o600 });
    return relativePath;
  }

  read(relativePath: string) {
    return readFile(this.resolvePrivatePath(relativePath));
  }

  async remove(relativePath: string) {
    await unlink(this.resolvePrivatePath(relativePath)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private resolvePrivatePath(relativePath: string) {
    if (
      basename(relativePath) === relativePath
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/.test(relativePath)
    ) {
      return resolve(this.root, relativePath);
    }
    throw new Error('invalid private media path');
  }
}
