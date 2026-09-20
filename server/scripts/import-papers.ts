import { config as loadEnvironmentFile } from 'dotenv';
import { sql } from 'kysely';
import { resolve } from 'node:path';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import { importPaperManifests } from '../src/features/bank/paper-import.js';
import { loadPaperManifests } from '../src/features/bank/paper-manifest.js';

async function main() {
  for (const environmentFile of environmentFilePaths('development')) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment({ ...process.env, NODE_ENV: 'development' });
  if (!['localhost', '127.0.0.1', '::1'].includes(environment.DB_HOST.toLowerCase())) {
    throw new Error('The development paper importer only accepts a local MySQL host');
  }

  const database = createDatabase(environment);
  try {
    const papers = await loadPaperManifests(resolve(process.cwd(), '../data/papers'));
    const imported = await importPaperManifests(database, papers);
    const counts = await Promise.all(
      (['paper', 'question', 'paper_question'] as const).map(async (tableName) => {
        const countResult = await sql<{ count: string }>`select count(*) as count from ${sql.table(
          tableName,
        )}`.execute(database);
        return [tableName, Number(countResult.rows[0]?.count ?? 0)] as const;
      }),
    );

    console.info(JSON.stringify({ imported, totals: Object.fromEntries(counts) }, null, 2));
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Paper import failed');
  process.exitCode = 1;
});
