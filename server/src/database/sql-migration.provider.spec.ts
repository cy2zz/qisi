import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqlMigrationProvider } from './sql-migration.provider.js';

describe('SqlMigrationProvider', () => {
  it('loads one SQL file per table from server/db', async () => {
    const provider = new SqlMigrationProvider(resolve(process.cwd(), 'db'));

    const migrations = await provider.getMigrations();

    expect(Object.keys(migrations)).toEqual(['users']);
    expect(migrations['users']).toHaveProperty('up');
    expect(migrations['users']).not.toHaveProperty('down');
  });

  it('rejects an empty table SQL file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qisi-migrations-'));
    await writeFile(join(directory, 'users.sql'), '   ');
    const provider = new SqlMigrationProvider(directory);

    await expect(provider.getMigrations()).rejects.toThrow('Table SQL users.sql is empty');
  });

  it('uses the shared database timestamp columns without a trailing definition comma', async () => {
    const statement = await readFile(resolve(process.cwd(), 'db/users.sql'), 'utf8');

    expect(statement).toContain('`db_update_time`');
    expect(statement).toContain('`db_create_time`');
    expect(statement).not.toMatch(/,\s*\)\s*ENGINE/);
  });
});
