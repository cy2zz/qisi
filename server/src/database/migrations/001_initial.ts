import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types.js';

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable('app_metadata')
    .ifNotExists()
    .addColumn('key', 'varchar(128)', (column) => column.primaryKey())
    .addColumn('value', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'datetime(3)', (column) =>
      column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
    )
    .modifyEnd(sql`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema.dropTable('app_metadata').ifExists().execute();
}
