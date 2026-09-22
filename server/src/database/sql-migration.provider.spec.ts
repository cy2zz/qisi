import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, type CompiledQuery } from 'kysely';
import { SqlMigrationProvider } from './sql-migration.provider.js';


const timestampRepairs = [
  ['v3_016_sessions_expiry', 'sessions', 'expires_at'],
  ['v3_017_requests_expiry', 'requests', 'expires_at'],
  ['v3_018_runs_deadline', 'runs', 'deadline_at'],
  ['v3_019_node_runs_started', 'node_runs', 'started_at'],
  ['v3_020_assessment_tasks_expiry', 'assessment_tasks', 'expires_at'],
  ['v3_021_seen_tasks_first_seen', 'seen_tasks', 'first_seen_at'],
  ['v3_022_check_attempts_started', 'check_attempts', 'started_at'],
  ['v3_023_learning_drafts_expiry', 'learning_drafts', 'expires_at'],
  ['v3_024_media_expiry', 'media', 'expires_at'],
  ['v3_025_transcripts_expiry', 'transcripts', 'expires_at'],
] as const;

describe('SqlMigrationProvider', () => {
  it('loads one SQL file per table from server/db', async () => {
    const provider = new SqlMigrationProvider(resolve(process.cwd(), 'db'));

    const migrations = await provider.getMigrations();

    expect(Object.keys(migrations)).toEqual([
      'users',
      'v2_001_paper',
      'v2_002_question',
      'v2_003_paper_question',
      'v3_001_sessions',
      'v3_002_requests',
      'v3_003_runs',
      'v3_004_node_runs',
      'v3_005_learning_messages',
      'v3_006_events',
      'v3_007_assessment_tasks',
      'v3_008_seen_tasks',
      'v3_009_check_attempts',
      'v3_010_owner_privacy_state',
      'v3_011_packets',
      'v3_012_learning_drafts',
      'v3_013_media',
      'v3_014_transcripts',
      'v3_015_probe_counters',
      ...timestampRepairs.map(([name]) => name),
    ]);
    for (const migration of Object.values(migrations)) {
      expect(migration).toHaveProperty('up');
      expect(migration).not.toHaveProperty('down');
    }
  });

  it('persists prepared packets by problem and runtime version', async () => {
    const packets = await readFile(resolve(process.cwd(), 'db/packets.sql'), 'utf8');

    expect(packets).toContain('PRIMARY KEY (`problem_hash`, `version`)');
    expect(packets).toContain('`packet_json`');
    expect(packets).toContain('`review_json`');
    expect(packets).toContain('`status`');
  });

  it('keeps handwriting media private and confirmation revisioned', async () => {
    const media = await readFile(resolve(process.cwd(), 'db/media.sql'), 'utf8');
    const transcripts = await readFile(resolve(process.cwd(), 'db/transcripts.sql'), 'utf8');

    expect(media).toContain('`private_path`');
    expect(media).toContain('`expires_at`');
    expect(media).toContain('ON DELETE CASCADE');
    expect(transcripts).toContain('`lines_json`');
    expect(transcripts).toContain('`revision`');
    expect(transcripts).toContain('`confirmed`');
  });

  it('persists an owner-level incomplete-history boundary after private data deletion', async () => {
    const privacyState = await readFile(
      resolve(process.cwd(), 'db/owner_privacy_state.sql'),
      'utf8',
    );

    expect(privacyState).toContain('`history_incomplete`');
    expect(privacyState).toContain('PRIMARY KEY (`user_id`)');
    expect(privacyState).toContain('ON DELETE CASCADE');
  });

  it('persists independent-check eligibility and the first locked attempt', async () => {
    const assessmentTasks = await readFile(
      resolve(process.cwd(), 'db/assessment_tasks.sql'),
      'utf8',
    );
    expect(assessmentTasks).toContain('`task_hash`');
    expect(assessmentTasks).toContain('`equivalence_group`');
    expect(assessmentTasks).toContain('`verification_json`');

    const seenTasks = await readFile(resolve(process.cwd(), 'db/seen_tasks.sql'), 'utf8');
    expect(seenTasks).toContain('UNIQUE KEY `uq_seen_tasks_user_task`');
    expect(seenTasks).toContain('`first_seen_eligible`');

    const attempts = await readFile(resolve(process.cwd(), 'db/check_attempts.sql'), 'utf8');
    expect(attempts).toContain('`locked_plan_markdown`');
    expect(attempts).toContain('`final_answer_markdown`');
    expect(attempts).toContain('`assistance_requested`');
    expect(attempts).toContain('`help_exposed`');
    expect(attempts).toContain('UNIQUE KEY `uq_check_attempts_session`');
  });

  it('keeps persisted learning facts owner-scoped and recoverable', async () => {
    const requiredTables = [
      'sessions',
      'requests',
      'runs',
      'node_runs',
      'learning_messages',
      'events',
    ];

    for (const tableName of requiredTables) {
      const statement = await readFile(resolve(process.cwd(), `db/${tableName}.sql`), 'utf8');
      expect(statement).toContain('`db_update_time`');
      expect(statement).toContain('`db_create_time`');
      expect(statement).not.toMatch(/,\s*\)\s*ENGINE/);
    }

    const sessions = await readFile(resolve(process.cwd(), 'db/sessions.sql'), 'utf8');
    expect(sessions).toContain('`user_id`');
    expect(sessions).toContain('`version`');
    expect(sessions).toContain('`active_run_id`');

    const requests = await readFile(resolve(process.cwd(), 'db/requests.sql'), 'utf8');
    expect(requests).toContain('UNIQUE KEY `uq_requests_user_request`');
    expect(requests).toContain('`safe_response_json`');

    const messages = await readFile(resolve(process.cwd(), 'db/learning_messages.sql'), 'utf8');
    expect(messages).toContain('`assistance_mode`');
    expect(messages).toContain('`content_markdown`');

    const drafts = await readFile(resolve(process.cwd(), 'db/learning_drafts.sql'), 'utf8');
    expect(drafts).toContain('`draft_markdown`');
    expect(drafts).toContain('`expires_at`');
    expect(drafts).toContain('PRIMARY KEY (`session_id`)');
    expect(drafts).toContain('ON DELETE CASCADE');
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

// No network: records the exact statements and connection acquisition used by up().
async function recordingDatabase(failDdl = false) {
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const driver = new DummyDriver();
  const connection = await driver.acquireConnection();
  const acquire = vi.spyOn(driver, 'acquireConnection').mockResolvedValue(connection);
  vi.spyOn(connection, 'executeQuery').mockImplementation(async <R>(query: CompiledQuery) => {
    queries.push({ sql: query.sql, parameters: query.parameters });
    if (failDdl && /(?:CREATE|ALTER) TABLE/.test(query.sql)) throw new Error('fixture DDL failure');
    return { rows: query.sql.startsWith('SELECT @@session.explicit_defaults_for_timestamp')
      ? [{ value: 0 } as R] : [] };
  });
  const database = new Kysely<unknown>({ dialect: {
    createDriver: () => driver,
    createAdapter: () => new MysqlAdapter(),
    createIntrospector: (db) => new MysqlIntrospector(db),
    createQueryCompiler: () => new MysqlQueryCompiler(),
  } });
  return { database, queries, acquire };
}

describe('timestamp migration regression', () => {
  it('runs DDL with explicit timestamp defaults on one connection, then restores its setting', async () => {
    const { database, queries, acquire } = await recordingDatabase();
    try {
      const migrations = await new SqlMigrationProvider(resolve(process.cwd(), 'db')).getMigrations();
      await migrations.users.up(database);
      expect(queries.map(({ sql }) => sql)).toEqual([
        'SELECT @@session.explicit_defaults_for_timestamp AS value',
        'SET SESSION explicit_defaults_for_timestamp = ON',
        expect.stringContaining('CREATE TABLE'),
        'SET SESSION explicit_defaults_for_timestamp = ?',
      ]);
      expect(queries[3].parameters).toEqual([0]);
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally { await database.destroy(); }
  });

  it('restores the connection setting even when DDL fails, without hiding the failure', async () => {
    const { database, queries } = await recordingDatabase(true);
    try {
      const migrations = await new SqlMigrationProvider(resolve(process.cwd(), 'db')).getMigrations();
      await expect(migrations.users.up(database)).rejects.toThrow('fixture DDL failure');
      expect(queries.at(-1)).toEqual({
        sql: 'SET SESSION explicit_defaults_for_timestamp = ?', parameters: [0],
      });
    } finally { await database.destroy(); }
  });

  it('loads the append-only repair from sessions.sql separately from the original CREATE', async () => {
    const { database, queries } = await recordingDatabase();
    try {
      const migrations = await new SqlMigrationProvider(resolve(process.cwd(), 'db')).getMigrations();
      expect(migrations.v3_016_sessions_expiry).toBeDefined();
      await migrations.v3_016_sessions_expiry.up(database);
      const ddl = queries.find(({ sql }) => sql.includes('ALTER TABLE'))?.sql;
      expect(ddl).toContain('ALTER TABLE \u0060sessions\u0060');
      expect(ddl).toContain('MODIFY COLUMN \u0060expires_at\u0060');
      expect(ddl).not.toMatch(/ON UPDATE|DEFAULT CURRENT_TIMESTAMP|CREATE TABLE/);
      queries.length = 0;
      await migrations.v3_001_sessions.up(database);
      expect(queries.filter(({ sql }) => sql.includes('CREATE TABLE'))).toHaveLength(1);
      expect(queries.some(({ sql }) => sql.includes('ALTER TABLE'))).toBe(false);
    } finally { await database.destroy(); }
  });

  it('rejects unregistered appended sections rather than silently skipping SQL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qisi-migrations-'));
    await writeFile(join(directory, 'users.sql'), 'SELECT 1;\n-- migration: unregistered_update\nSELECT 2;');
    await expect(new SqlMigrationProvider(directory).getMigrations()).rejects.toThrow(/unregistered_update/);
  });
});

describe('all affected business timestamps', () => {
  it.each(timestampRepairs)('%s is a column-only upgrade in %s.sql', async (name, tableName, columnName) => {
    const { database, queries } = await recordingDatabase();
    try {
      const migrations = await new SqlMigrationProvider(resolve(process.cwd(), 'db')).getMigrations();
      expect(migrations[name]).toBeDefined();
      await migrations[name].up(database);
      const ddl = queries.find(({ sql }) => sql.includes('ALTER TABLE'))?.sql;
      expect(ddl).toContain('ALTER TABLE ' + String.fromCharCode(96) + tableName + String.fromCharCode(96));
      expect(ddl).toContain('MODIFY COLUMN ' + String.fromCharCode(96) + columnName + String.fromCharCode(96));
      expect(ddl).not.toMatch(/ON UPDATE|DEFAULT CURRENT_TIMESTAMP|CREATE TABLE|DROP|DELETE/);
    } finally { await database.destroy(); }
  });
});
