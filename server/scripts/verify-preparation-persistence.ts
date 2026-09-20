import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadEnvironmentFile } from 'dotenv';
import { sql } from 'kysely';
import { PacketSchema } from '../src/contracts/domain.schema.js';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { PreparationRepository } from '../src/features/preparation/preparation.repository.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }

  const database = createDatabase(parseEnvironment(process.env));
  const packetFixture = PacketSchema.parse(JSON.parse(await readFile(
    resolve(process.cwd(), '..', 'qisi-sdd-v3', 'fixtures', 'packet.json'),
    'utf8',
  )));
  const version = randomBytes(32).toString('hex');
  const problemHash = packetFixture.problem_hash;
  const repository = new PreparationRepository({ client: database } as DatabaseService);

  try {
    const runtime = await sql<{ version: string }>`select version() as version`.execute(database);
    const mysqlVersion = runtime.rows[0]?.version ?? 'unknown';
    await repository.save({
      configHash: 'persistence-fixture',
      modelId: 'fixture-model',
      packet: { ...packetFixture, ready: false, version },
      problemHash,
      promptVersion: 'prompt-v3.0',
      review: { fixture: true },
      status: 'needs_review',
      version,
    });
    const first = await repository.find(problemHash, version);
    if (!first || first.status !== 'needs_review' || first.packet.ready) {
      throw new Error('needs_review packet did not round-trip');
    }

    await repository.save({
      configHash: 'persistence-fixture',
      modelId: 'fixture-model',
      packet: { ...packetFixture, ready: true, version },
      problemHash,
      promptVersion: 'prompt-v3.0',
      review: { fixture: true, reviewed: true },
      status: 'ready',
      version,
    });
    const updated = await repository.find(problemHash, version);
    if (!updated || updated.status !== 'ready' || !updated.packet.ready) {
      throw new Error('ready packet update did not round-trip');
    }

    console.info(`preparation persistence passed: MySQL ${mysqlVersion}, needs_review -> ready, exact cache key`);
  } finally {
    await database
      .deleteFrom('packets')
      .where('problem_hash', '=', Buffer.from(problemHash, 'hex'))
      .where('version', '=', version)
      .execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Preparation persistence check failed');
  process.exitCode = 1;
});
