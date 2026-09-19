import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqlMigrationProvider } from './sql-migration.provider.js';

describe('SqlMigrationProvider', () => {
  it('loads one SQL file per table from server/db', async () => {
    const provider = new SqlMigrationProvider(resolve(process.cwd(), 'db'));

    const migrations = await provider.getMigrations();

    expect(Object.keys(migrations)).toEqual([
      'users',
      'v2_001_paper',
      'v2_002_question',
      'v2_003_paper_question',
    ]);
    for (const migration of Object.values(migrations)) {
      expect(migration).toHaveProperty('up');
      expect(migration).not.toHaveProperty('down');
    }
  });

  it('rejects an empty table SQL file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qisi-migrations-'));
    await writeFile(join(directory, 'users.sql'), '   ');
    const provider = new SqlMigrationProvider(directory);

    await expect(provider.getMigrations()).rejects.toThrow('Table SQL users.sql is empty');
  });

  it('rejects SQL files that were not appended to the stable migration order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qisi-migrations-'));
    await writeFile(join(directory, 'users.sql'), 'SELECT 1;');
    await writeFile(join(directory, 'unexpected.sql'), 'SELECT 1;');
    const provider = new SqlMigrationProvider(directory);

    await expect(provider.getMigrations()).rejects.toThrow(
      'Table SQL unexpected.sql is missing from the stable migration order',
    );
  });

  it('uses the shared database timestamp columns without a trailing definition comma', async () => {
    const statement = await readFile(resolve(process.cwd(), 'db/users.sql'), 'utf8');

    expect(statement).toContain('`db_update_time`');
    expect(statement).toContain('`db_create_time`');
    expect(statement).not.toMatch(/,\s*\)\s*ENGINE/);
  });

  it('keeps the paper and question tables intentionally minimal', async () => {
    const tableNames = ['paper', 'paper_question', 'question'];

    for (const tableName of tableNames) {
      const statement = await readFile(resolve(process.cwd(), `db/${tableName}.sql`), 'utf8');

      expect(statement).toContain('`db_update_time`');
      expect(statement).toContain('`db_create_time`');
      expect(statement).toContain('PRIMARY KEY (`id`)');
      expect(statement).not.toMatch(/\b(?:CONSTRAINT|FOREIGN KEY|UNIQUE KEY|CHECK)\b/);
      expect(statement).not.toMatch(/\bKEY `(?:idx|uq)_/);
      expect(statement).not.toMatch(/,\s*\)\s*ENGINE/);
    }

    const question = await readFile(resolve(process.cwd(), 'db/question.sql'), 'utf8');
    expect(question).toContain('`question_code`              VARCHAR(128)    NULL');
    expect(question).not.toContain('`paper_id`');

    const paperQuestion = await readFile(
      resolve(process.cwd(), 'db/paper_question.sql'),
      'utf8',
    );
    expect(paperQuestion).toContain('`paper_id`');
    expect(paperQuestion).toContain('`question_id`');
    expect(paperQuestion).toContain('`question_number`');
  });
});
