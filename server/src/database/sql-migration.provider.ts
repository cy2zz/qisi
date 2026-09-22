import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely/migration';

const SQL_SUFFIX = '.sql';
const MIGRATION_REGISTRY: ReadonlyArray<{ fileName: string; migrationName: string; section?: string }> = [
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
  { fileName: 'probe_counters', migrationName: 'v3_015_probe_counters' },
  { fileName: 'sessions', migrationName: 'v3_016_sessions_expiry', section: 'v3_016_sessions_expiry' },
  { fileName: 'requests', migrationName: 'v3_017_requests_expiry', section: 'v3_017_requests_expiry' },
  { fileName: 'runs', migrationName: 'v3_018_runs_deadline', section: 'v3_018_runs_deadline' },
  { fileName: 'node_runs', migrationName: 'v3_019_node_runs_started', section: 'v3_019_node_runs_started' },
  { fileName: 'assessment_tasks', migrationName: 'v3_020_assessment_tasks_expiry', section: 'v3_020_assessment_tasks_expiry' },
  { fileName: 'seen_tasks', migrationName: 'v3_021_seen_tasks_first_seen', section: 'v3_021_seen_tasks_first_seen' },
  { fileName: 'check_attempts', migrationName: 'v3_022_check_attempts_started', section: 'v3_022_check_attempts_started' },
  { fileName: 'learning_drafts', migrationName: 'v3_023_learning_drafts_expiry', section: 'v3_023_learning_drafts_expiry' },
  { fileName: 'media', migrationName: 'v3_024_media_expiry', section: 'v3_024_media_expiry' },
  { fileName: 'transcripts', migrationName: 'v3_025_transcripts_expiry', section: 'v3_025_transcripts_expiry' },
];

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

    // Each file owns both CREATE and append-only upgrades. Never send a whole
    // multi-section file as one query or enable mysql2 multipleStatements.
    const statements = new Map<string, string>();
    for (const fileName of discoveredTableNames) {
      const source = await readFile(join(this.migrationDirectory, `${fileName}.sql`), 'utf8');
      const sections = source.split(/^-- migration: ([a-z][a-z0-9_]*)[ \t]*\r?$/m);
      const initial = MIGRATION_REGISTRY.find((entry) => entry.fileName === fileName && !entry.section);
      if (!initial) throw new Error(`Table SQL ${fileName}.sql has no CREATE registration`);
      for (let index = 0; index < sections.length; index += 2) {
        const name = index === 0 ? initial.migrationName : sections[index - 1];
        const statement = sections[index].trim();
        if (!statement) throw new Error(`Table SQL ${fileName}.sql is empty (section ${name})`);
        if (!MIGRATION_REGISTRY.some((entry) => entry.fileName === fileName && entry.migrationName === name)
          || statements.has(name)) {
          throw new Error(`Unregistered or duplicate SQL migration section: ${name}`);
        }
        statements.set(name, statement);
      }
    }

    const migrations: Record<string, Migration> = {};
    for (const { fileName, migrationName } of migrationsToLoad) {
      const statement = statements.get(migrationName);
      if (!statement) throw new Error(`Missing SQL migration section ${migrationName} in ${fileName}.sql`);
      migrations[migrationName] = {
        up: async (database) => {
          // Pin SET/DDL/restore to one connection, including direct up() callers.
          // Legacy MySQL settings must not turn a business expiry into ON UPDATE NOW().
          await database.connection().execute(async (connection) => {
            const result = await sql<{ value: number }>`SELECT @@session.explicit_defaults_for_timestamp AS value`.execute(connection);
            const previous = result.rows[0]?.value;
            if (previous !== 0 && previous !== 1) throw new Error('Unknown timestamp defaults setting');
            try {
              await sql`SET SESSION explicit_defaults_for_timestamp = ON`.execute(connection);
              await sql.raw(statement).execute(connection);
            } finally {
              await sql`SET SESSION explicit_defaults_for_timestamp = ${previous}`.execute(connection);
            }
          });
        },
      };
    }

    return migrations;
  }
}
