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
  { fileName: 'sessions', migrationName: 'v3_001_sessions' },
  { fileName: 'requests', migrationName: 'v3_002_requests' },
  { fileName: 'runs', migrationName: 'v3_003_runs' },
  { fileName: 'node_runs', migrationName: 'v3_004_node_runs' },
  { fileName: 'learning_messages', migrationName: 'v3_005_learning_messages' },
  { fileName: 'events', migrationName: 'v3_006_events' },
  { fileName: 'assessment_tasks', migrationName: 'v3_007_assessment_tasks' },
  { fileName: 'seen_tasks', migrationName: 'v3_008_seen_tasks' },
  { fileName: 'check_attempts', migrationName: 'v3_009_check_attempts' },
  { fileName: 'owner_privacy_state', migrationName: 'v3_010_owner_privacy_state' },
  { fileName: 'packets', migrationName: 'v3_011_packets' },
  { fileName: 'learning_drafts', migrationName: 'v3_012_learning_drafts' },
  { fileName: 'media', migrationName: 'v3_013_media' },
  { fileName: 'transcripts', migrationName: 'v3_014_transcripts' },
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
