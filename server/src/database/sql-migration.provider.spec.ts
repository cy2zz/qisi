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
