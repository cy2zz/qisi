import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../../database/database.service.js';

export interface PublicUser {
  id: string;
  username: string;
}

interface RotateTokenInput {
  username: string;
  usernameNormalized: string;
  tokenHash: Buffer;
}

@Injectable()
export class UserRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async upsertAndRotateToken(input: RotateTokenInput): Promise<PublicUser> {
    await this.database.client
      .insertInto('users')
      .values({
        username: input.username,
        username_normalized: input.usernameNormalized,
        cookie_token_hash: input.tokenHash,
      })
      .onDuplicateKeyUpdate({
        username: input.username,
        cookie_token_hash: input.tokenHash,
        db_update_time: sql`CURRENT_TIMESTAMP`,
      })
      .execute();

    const user = await this.database.client
      .selectFrom('users')
      .select(['id', 'username'])
      .where('username_normalized', '=', input.usernameNormalized)
      .executeTakeFirst();

    if (!user) {
      throw new InternalServerErrorException('user was not persisted');
    }

    return { id: String(user.id), username: user.username };
  }

  async findByTokenHash(tokenHash: Buffer): Promise<PublicUser | undefined> {
    const user = await this.database.client
      .selectFrom('users')
      .select(['id', 'username'])
      .where('cookie_token_hash', '=', tokenHash)
      .executeTakeFirst();

    return user ? { id: String(user.id), username: user.username } : undefined;
  }
}
