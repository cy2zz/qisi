import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { AppEnvironment } from '../config/env.js';
import { createDatabase } from './database.factory.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client;

  constructor(@Inject(ConfigService) config: ConfigService<AppEnvironment, true>) {
    this.client = createDatabase({
      DB_HOST: config.get('DB_HOST', { infer: true }),
      DB_PORT: config.get('DB_PORT', { infer: true }),
      DB_NAME: config.get('DB_NAME', { infer: true }),
      DB_USER: config.get('DB_USER', { infer: true }),
      DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
      DB_SSL: config.get('DB_SSL', { infer: true }),
      DB_SSL_CA_PATH: config.get('DB_SSL_CA_PATH', { infer: true }),
      DB_CONNECTION_LIMIT: config.get('DB_CONNECTION_LIMIT', { infer: true }),
    });
  }

  async ping() {
    await sql`select 1 as ok`.execute(this.client);
  }

  async onModuleDestroy() {
    await this.client.destroy();
  }
}
