import 'reflect-metadata';
import { config as loadEnvironmentFile } from 'dotenv';
import { sql } from 'kysely';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }

  const database = createDatabase(parseEnvironment(process.env));

  try {
    const runtime = await sql<{
      version: string;
      timeZone: string;
      isolationLevel: string;
    }>`
      select
        version() as version,
        @@session.time_zone as timeZone,
        @@session.transaction_isolation as isolationLevel
    `.execute(database);
    const current = runtime.rows[0];
    if (!current || !/^8\.(?:0|4)\./.test(current.version)) {
      throw new Error(`Unsupported MySQL version: ${current?.version ?? 'unknown'}`);
    }
    if (current.timeZone !== '+00:00' || current.isolationLevel !== 'READ-COMMITTED') {
      throw new Error(
        `Unexpected session settings: time_zone=${current.timeZone}, isolation=${current.isolationLevel}`,
      );
    }

    const columns = await sql<{ columnName: string }>`
      select column_name as columnName
      from information_schema.columns
      where table_schema = database() and table_name = 'users'
    `.execute(database);
    const columnNames = new Set(columns.rows.map(({ columnName }) => columnName));
    for (const requiredColumn of ['id', 'username', 'db_update_time', 'db_create_time']) {
      if (!columnNames.has(requiredColumn)) {
        throw new Error(`users.${requiredColumn} is missing`);
      }
    }

    const tables = await sql<{ tableName: string }>`
      select table_name as tableName
      from information_schema.tables
      where table_schema = database()
    `.execute(database);
    const tableNames = new Set(tables.rows.map(({ tableName }) => tableName));
    for (const requiredTable of [
      'sessions',
      'requests',
      'runs',
      'node_runs',
      'learning_messages',
      'events',
      'assessment_tasks',
      'seen_tasks',
      'check_attempts',
      'owner_privacy_state',
      'packets',
    ]) {
      if (!tableNames.has(requiredTable)) {
        throw new Error(`${requiredTable} table is missing`);
      }
    }

    console.info(
      `database smoke passed: MySQL ${current.version}, UTC, READ COMMITTED, users, packets, and learning persistence schema`,
    );
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Database smoke failed');
  process.exitCode = 1;
});
