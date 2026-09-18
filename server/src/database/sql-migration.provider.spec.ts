import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqlMigrationProvider } from './sql-migration.provider.js';

describe('SqlMigrationProvider', () => {
  it('loads one SQL file per table from server/db', async () => {
    const directory = resolve(process.cwd(), 'db');
    const provider = new SqlMigrationProvider(directory);

    const migrations = await provider.getMigrations();

    // 期望值由目录实际内容推导，而非硬编码文件名列表。硬编码会在任何人按
    // AGENTS.md §53 的约定往 server/db 新增表文件时失败，那是约定的正常使用方式。
    const tableNames = (await readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, -'.sql'.length))
      .sort();

    expect(tableNames.length).toBeGreaterThan(0);
    expect(Object.keys(migrations)).toEqual(tableNames);

    // 每个表文件都应产出一个仅有 up、没有 down 的迁移。
    for (const tableName of tableNames) {
      expect(migrations[tableName], `缺少迁移 ${tableName}`).toHaveProperty('up');
      expect(migrations[tableName]).not.toHaveProperty('down');
    }
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
