import { config as loadEnvironmentFile } from 'dotenv';
import { environmentFilePaths, parseEnvironment } from './config/env.js';
import { createDatabase } from './database/database.factory.js';
import { PrivateMediaStorageService } from './features/media/private-media-storage.service.js';
import { runRetentionCleanup } from './shared/retention.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  const database = createDatabase(environment);
  const storage = new PrivateMediaStorageService({
    get: () => environment.MEDIA_STORAGE_ROOT,
  } as never);
  try {
    const result = await runRetentionCleanup(database, new Date(), storage);
    console.info(JSON.stringify(result));
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Retention cleanup failed');
  process.exitCode = 1;
});
