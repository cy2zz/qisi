import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely/migration';

const SQL_SUFFIX = '.sql';
const MIGRATION_REGISTRY = [
  { fileName: 'users', migrationName: 'users' },
  { fileName: 'paper', migrationName: 'v2_001_paper' },
  { fileName: 'question', migrationName: 'v2_002_question' },
  { fileName: 'paper_question', migrationName: 'v2_003_paper_question' },
] as const;

export class SqlMigrationProvider implements MigrationProvider {
  constructor(private readonly migrationDirectory: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const entries = await readdir(this.migrationDirectory, { withFileTypes: true });
    const discoveredTableNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(SQL_SUFFIX))
      .map((entry) => entry.name.slice(0, -SQL_SUFFIX.length));
    const registeredTableNames = new Set<string>(
      MIGRATION_REGISTRY.map(({ fileName }) => fileName),
    );
    const unregisteredTableName = discoveredTableNames.find(
      (tableName) => !registeredTableNames.has(tableName),
    );
    if (unregisteredTableName) {
      throw new Error(
        `Table SQL ${unregisteredTableName}.sql is missing from the stable migration order`,
      );
    }
    const discoveredTableNameSet = new Set(discoveredTableNames);
    const migrationsToLoad = MIGRATION_REGISTRY.filter(({ fileName }) =>
      discoveredTableNameSet.has(fileName),
    );

    const migrations: Record<string, Migration> = {};
    for (const { fileName, migrationName } of migrationsToLoad) {
      const statement = await readFile(join(this.migrationDirectory, `${fileName}.sql`), 'utf8');
      if (!statement.trim()) {
        throw new Error(`Table SQL ${fileName}.sql is empty`);
      }

      migrations[migrationName] = {
        up: async (database) => {
          await sql.raw(statement).execute(database);
        },
      };
    }

    return migrations;
  }
}
