import type { ColumnType, Generated } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  username: string;
  username_normalized: string;
  cookie_token_hash: Buffer;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface Database {
  users: UsersTable;
}
