import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { SqlMigrationProvider } from '../../src/database/sql-migration.provider.js';
import { createDatabase } from '../../src/database/database.factory.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { LearningSessionService } from '../../src/features/learning/learning-session.service.js';
import { LearningSessionController } from '../../src/features/learning/learning-session.controller.js';
import { AuthService } from '../../src/features/auth/auth.service.js';
import { UserRepository } from '../../src/features/auth/user.repository.js';
import { AUTH_COOKIE_NAME } from '../../src/features/auth/auth.cookie.js';
import { ProblemAnalysisController } from '../../src/features/analysis/problem-analysis.controller.js';
import { ProblemAnalysisService } from '../../src/features/analysis/problem-analysis.service.js';
import { BankService } from '../../src/features/bank/bank.service.js';
import { QuestionImageLoader } from '../../src/features/media/question-image-loader.js';
import { QuestionImageRecognitionService } from '../../src/features/media/question-image-recognition.service.js';
import { MediaService } from '../../src/features/media/media.service.js';
import { PreparationService } from '../../src/features/preparation/preparation.service.js';

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

// Opt-in only; never load the application's .env or use an existing business schema.
// Provision TWO empty schemas named <MYSQL_TEST_DATABASE>_fresh and ..._upgrade.
describe('real MySQL timestamp regression (isolated fixture data)', () => {
  it.runIf(process.env.QISI_MYSQL_SPEC_TEST === '1').each(['fresh', 'upgrade'])(
    '%s: preserves expiry through two turns and drafts; retains owner/TTL checks',
    async (mode) => {
      const prefix = process.env.MYSQL_TEST_DATABASE ?? '';
      if (!/^qisi_spec_[a-z0-9_]+$/.test(prefix)) throw new Error('An explicit qisi_spec_* test database is required');
      const port = Number(process.env.MYSQL_TEST_PORT);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Explicit MYSQL_TEST_PORT is required');
      const database = createDatabase({
        DB_HOST: '127.0.0.1', DB_PORT: port, DB_NAME: `${prefix}_${mode}`,
        DB_USER: process.env.MYSQL_TEST_USER ?? 'root', DB_PASSWORD: process.env.MYSQL_TEST_PASSWORD ?? '',
        DB_SSL: false, DB_SSL_CA_PATH: '', DB_CONNECTION_LIMIT: 1,
      });
      let app: INestApplication | undefined;
      try {
        const existing = await sql`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`.execute(database);
        if (existing.rows.length) throw new Error('Refusing to write a non-empty test schema');
        const runtime = await sql<{ version: string }>`SELECT VERSION() AS version`.execute(database);
        expect(runtime.rows[0].version).toMatch(/^8\.(?:0|4)\./);
        const provider = new SqlMigrationProvider(resolve(process.cwd(), 'db'));
        const migrations = await provider.getMigrations();
        if (mode === 'upgrade') {
          // Reproduce the old migration path with implicit defaults OFF. SQL still
          // comes exclusively from server/db, not a second test-owned schema.
          const legacy: Record<string, Migration> = {};
          for (const name of Object.keys(migrations).filter((key) => !timestampRepairs.some(([name]) => name === key))) {
            const fileName = name.replace(/^v[0-9]+_[0-9]+_/, '');
            const source = await readFile(resolve(process.cwd(), `db/${fileName}.sql`), 'utf8');
            legacy[name] = { up: async (db) => { await sql.raw(source.split(/^-- migration:/m)[0]).execute(db); } };
          }
          await database.connection().execute(async (connection) => {
            await sql`SET SESSION explicit_defaults_for_timestamp = OFF`.execute(connection);
            const result = await new Migrator({ db: connection, provider: { getMigrations: async () => legacy } }).migrateToLatest();
            if (result.error) throw result.error;
          });
        } else {
          const result = await new Migrator({ db: database, provider }).migrateToLatest();
          if (result.error) throw result.error;
        }
        const store = { client: database } as DatabaseService;
        const auth = new AuthService(new UserRepository(store));
        const { user, token } = await auth.login('expiry-fixture');
        const ownerId = user.id;
        const cookie = `${AUTH_COOKIE_NAME}=${token}`;
        const service = new LearningSessionService(store);
        const session = await service.createSession({
          ownerId, content: 'fixture problem', problemMd: 'fixture problem',
          analysis: { firstQuestion: 'fixture probe', keyConditions: ['fixture'], knowledgePoints: ['fixture'], overview: 'fixture overview', target: 'fixture target' },
        });
        const readExpiry = async () => (await database.selectFrom('sessions').select('expires_at').where('id', '=', session.id).executeTakeFirstOrThrow()).expires_at.getTime();
        const expiresAt = await readExpiry();
        if (mode === 'upgrade') {
          await database.updateTable('sessions').set({ version: 2 }).where('id', '=', session.id).execute();
          expect(await readExpiry()).toBeLessThan(expiresAt);
          await expect(service.getSession(ownerId, session.id)).rejects.toThrow('learning session not found');
          // Restore this synthetic fixture only, before testing the column-only upgrade.
          await database.updateTable('sessions').set({ version: 1, expires_at: new Date(expiresAt) }).where('id', '=', session.id).execute();
          const result = await new Migrator({ db: database, provider }).migrateToLatest();
          if (result.error) throw result.error;
          expect(result.results?.map((item) => item.migrationName)).toEqual(timestampRepairs.map(([name]) => name));
          expect(await readExpiry()).toBe(expiresAt);
        }
        const columns = await sql<{ name: string; extra: string; defaultValue: string | null }>`SELECT COLUMN_NAME AS name, EXTRA AS extra, COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions' AND COLUMN_NAME IN ('expires_at', 'db_update_time')`.execute(database);
        expect(columns.rows.find((row) => row.name === 'expires_at')).toMatchObject({ extra: '', defaultValue: null });
        expect(columns.rows.find((row) => row.name === 'db_update_time')?.extra.toLowerCase()).toContain('on update');
        const businessColumns = await sql<{ tableName: string; name: string; extra: string; defaultValue: string | null }>`
          SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, EXTRA AS extra, COLUMN_DEFAULT AS defaultValue
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'timestamp'
        `.execute(database);
        for (const [, tableName, name] of timestampRepairs) {
          expect(businessColumns.rows.find((row) => row.tableName === tableName && row.name === name))
            .toMatchObject({ extra: '', defaultValue: null });
        }
        // Real Nest controllers, Cookie authentication and MySQL persistence.
        // Only the already-checked model reply is synthetic; no provider/API key is used.
        const reply = vi.fn(async () => ({ reply: 'synthetic checked reply', currentVerdict: 'unknown' }));
        const module = await Test.createTestingModule({
          controllers: [LearningSessionController, ProblemAnalysisController],
          providers: [
            { provide: AuthService, useValue: auth },
            { provide: LearningSessionService, useValue: service },
            { provide: ConfigService, useValue: new ConfigService({ WEB_ORIGIN: 'http://localhost:5173' }) },
            { provide: ProblemAnalysisService, useValue: { reply } },
            ...[BankService, QuestionImageLoader, QuestionImageRecognitionService, MediaService, PreparationService]
              .map((provide) => ({ provide, useValue: {} })),
          ],
        }).compile();
        app = module.createNestApplication({ logger: false });
        app.setGlobalPrefix('api');
        await app.listen(0, '127.0.0.1');
        const http = request(app.getHttpServer());
        const sessionPath = `/api/learning/sessions/${session.id}`;
        await http.get(sessionPath).expect(401);
        for (let index = 0; index < 2; index += 1) {
          const state = await service.getSession(ownerId, session.id);
          await http.get(sessionPath).set('Cookie', cookie).expect(200);
          await http.patch(`${sessionPath}/draft`).set('Cookie', cookie)
            .send({ markdown: 'synthetic draft' }).expect(200);
          expect((await service.getSession(ownerId, session.id)).draftMarkdown).toBe('synthetic draft');
          const input = {
            sessionId: session.id, expectedVersion: state.record.version, history: [], problemMd: 'fixture problem',
            assistanceMode: 'attempt' as const, message: 'synthetic attempt', requestId: randomUUID(),
          };
          await http.post('/api/problems/chat').set('Cookie', cookie).set('Origin', 'https://attacker.example')
            .send(input).expect(403);
          const response = await http.post('/api/problems/chat').set('Cookie', cookie)
            .set('Origin', 'http://localhost:5173').send(input).expect(200);
          expect(response.text).toContain('event: done');
          expect(response.text).not.toContain('event: error');
          expect((await service.getSession(ownerId, session.id)).record.version).toBe(state.record.version + 1);
          expect(await readExpiry()).toBe(expiresAt);
          const run = await database.selectFrom('runs').select('deadline_at').where('request_id', '=', input.requestId).executeTakeFirstOrThrow();
          const storedRequest = await database.selectFrom('requests').select('expires_at').where('request_id', '=', input.requestId).executeTakeFirstOrThrow();
          expect(run.deadline_at.getTime()).toBeGreaterThan(Date.now());
          expect(storedRequest.expires_at.getTime()).toBeGreaterThan(Date.now());
          const replay = await http.post('/api/problems/chat').set('Cookie', cookie)
            .set('Origin', 'http://localhost:5173').send(input).expect(200);
          expect(replay.text).toContain('event: done');
          expect(reply).toHaveBeenCalledTimes(index + 1);
          await http.get(sessionPath).set('Cookie', cookie).expect(200);
        }
        const other = await auth.login('other-expiry-fixture');
        await http.get(sessionPath).set('Cookie', `${AUTH_COOKIE_NAME}=${other.token}`).expect(404);
        const repeated = await new Migrator({ db: database, provider }).migrateToLatest();
        if (repeated.error) throw repeated.error;
        expect(repeated.results ?? []).toEqual([]);
        await expect(service.getSession('0', session.id)).rejects.toThrow('learning session not found');
        await database.updateTable('sessions').set({ expires_at: new Date(Date.now() - 60_000) }).where('id', '=', session.id).execute();
        await expect(service.getSession(ownerId, session.id)).rejects.toThrow('learning session not found');
        await expect(service.saveDraft(ownerId, session.id, 'expired')).rejects.toThrow('learning session not found');
        await http.get(sessionPath).set('Cookie', cookie).expect(404);
        await http.patch(`${sessionPath}/draft`).set('Cookie', cookie).send({ markdown: 'expired' }).expect(404);
        const restored = await sql<{ value: number }>`SELECT @@session.explicit_defaults_for_timestamp AS value`.execute(database);
        expect(restored.rows[0].value).toBe(0);
      } finally { await app?.close(); await database.destroy(); }
    }, 60_000,
  );
});
