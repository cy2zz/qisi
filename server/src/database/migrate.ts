import 'reflect-metadata';
import { config as loadEnvironmentFile } from 'dotenv';
import { sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { environmentFilePaths, parseEnvironment } from '../config/env.js';
import { createDatabase } from './database.factory.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }

  const environment = parseEnvironment(process.env);
  const database = createDatabase(environment);

  try {
    const versionResult = await sql<{ version: string }>`select version() as version`.execute(database);
    const version = versionResult.rows[0]?.version ?? '';
    if (!version.startsWith('8.4.')) {
      throw new Error(`MySQL 8.4.x is required; received ${version || 'unknown'}`);
    }

    const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
    const migrator = new Migrator({
      db: database,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.join(currentDirectory, 'migrations'),
      }),
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
