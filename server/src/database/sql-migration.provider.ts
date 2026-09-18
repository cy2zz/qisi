import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely/migration';

const SQL_SUFFIX = '.sql';

export class SqlMigrationProvider implements MigrationProvider {
  constructor(private readonly migrationDirectory: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const entries = await readdir(this.migrationDirectory, { withFileTypes: true });
    const tableNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(SQL_SUFFIX))
      .map((entry) => entry.name.slice(0, -SQL_SUFFIX.length))
      .sort();

    const migrations: Record<string, Migration> = {};
    for (const tableName of tableNames) {
      const statement = await readFile(join(this.migrationDirectory, `${tableName}.sql`), 'utf8');
      if (!statement.trim()) {
        throw new Error(`Table SQL ${tableName}.sql is empty`);
      }

      migrations[tableName] = {
        up: async (database) => {
          await sql.raw(statement).execute(database);
        },
      };
    }

    return migrations;
  }
}
