import 'reflect-metadata';
import { config as loadEnvironmentFile } from 'dotenv';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { resolve } from 'node:path';
import { environmentFilePaths, parseEnvironment } from '../config/env.js';
import { createDatabase } from './database.factory.js';
import { SqlMigrationProvider } from './sql-migration.provider.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }

  const environment = parseEnvironment(process.env);
  const database = createDatabase(environment);

  try {
    const versionResult = await sql<{ version: string }>`select version() as version`.execute(database);
    const version = versionResult.rows[0]?.version ?? '';
    if (!/^8\.(?:0|4)\./.test(version)) {
      throw new Error(`MySQL 8.0.x or 8.4.x is required; received ${version || 'unknown'}`);
    }

    const migrator = new Migrator({
      db: database,
      provider: new SqlMigrationProvider(resolve(process.cwd(), 'db')),
    });
    const result = await migrator.migrateToLatest();

    for (const migration of result.results ?? []) {
      console.info(`${migration.migrationName}: ${migration.status}`);
    }
    if (result.error) {
      throw result.error;
    }
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
