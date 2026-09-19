import { config as loadEnvironmentFile } from 'dotenv';
import { environmentFilePaths, parseEnvironment } from './config/env.js';
import { createDatabase } from './database/database.factory.js';
import { runRetentionCleanup } from './shared/retention.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const database = createDatabase(parseEnvironment(process.env));
  try {
    const result = await runRetentionCleanup(database);
    console.info(JSON.stringify(result));
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Retention cleanup failed');
  process.exitCode = 1;
});
