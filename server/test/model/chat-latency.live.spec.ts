// Explicit opt-in: real configured model + NEW isolated MySQL only. Never migrate the business DB.
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/config/env.js';
import { createDatabase } from '../../src/database/database.factory.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { SqlMigrationProvider } from '../../src/database/sql-migration.provider.js';
import { LearningSessionService } from '../../src/features/learning/learning-session.service.js';

const enabled = process.env.QISI_MYSQL_SPEC_TEST === '1' && process.env.QISI_LIVE_MODEL_TEST === '1';
const origin = 'http://localhost:5173';
const problemMd = '求不等式 $\\frac{x-1}{x-3}<0$ 的解集。';
const analysis = {
  overview: '考察分子和分母的符号，结合严格不等号判断取值范围。',
  firstQuestion: '哪些值是需要分开讨论的分界点？',
  keyConditions: ['分母不能为零', '严格小于零'],
  knowledgePoints: ['分式不等式', '符号分析'], target: '求不等式的解集',
};
const sseData = z.record(z.string(), z.unknown());
function eventsFrom(text: string) {
  return text.split('\n\n').filter((block) => block.trim()).map((block) => {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const data = sseData.parse(JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}'));
    return { event, data };
  });
}
function jsonValue(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }

let app: INestApplication | undefined;
let db: ReturnType<typeof createDatabase> | undefined;
let ownerId: string;
let cookie: string;

describe.skipIf(!enabled)('live chat with isolated MySQL and configured project model', () => {
  beforeAll(async () => {
    const e = process.env;
    const name = e.QISI_MYSQL_SPEC_NAME ?? '';
    const port = Number(e.QISI_MYSQL_SPEC_PORT);
    if (e.QISI_MYSQL_SPEC_HOST !== '127.0.0.1' || !/^qisi_spec_[a-z0-9_]+$/.test(name)
      || !Number.isInteger(port) || port < 1024 || port === 3306
      || e.QISI_MYSQL_SPEC_USER !== 'qisi_spec' || !e.QISI_MYSQL_SPEC_PASSWORD) {
      throw new Error('refusing a non-isolated database target');
    }
    // Read only AI configuration from project files. Their DB settings are never copied or used.
    const ai: Record<string, string> = {};
    for (const file of ['.env.development.local', '.env.development', '.env.local', '.env']) {
      if (!existsSync(file)) continue;
      for (const [key, value] of Object.entries(parse(readFileSync(file)))) {
        if (['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_TIMEOUT_MS'].includes(key) && !(key in ai)) ai[key] = value;
      }
    }
    if (!ai.AI_API_KEY) throw new Error('live model opt-in requires the configured project key');
    const isolated = {
      DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: name, DB_USER: 'qisi_spec',
      DB_PASSWORD: e.QISI_MYSQL_SPEC_PASSWORD, DB_SSL: 'false', NODE_ENV: 'test', WEB_ORIGIN: origin,
    };
    const config = parseEnvironment({ ...ai, ...isolated });
    db = createDatabase(config);
    const count = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=${name}`.execute(db);
    if (Number(count.rows[0]?.n) !== 0) throw new Error('refusing a non-empty test schema');
    const migration = await new Migrator({ db, provider: new SqlMigrationProvider(fileURLToPath(new URL('../../db/', import.meta.url))) }).migrateToLatest();
    if (migration.error) throw new Error('isolated test migration failed');
    const version = await sql<{ version: string }>`SELECT VERSION() AS version`.execute(db);
    console.log(JSON.stringify({ isolatedMysql: version.rows[0]?.version, model: config.AI_MODEL, providerMode: 'real', preparationMode: 'synthetic fixture', existingBusinessDatabaseUsed: false }));

    // Even ConfigModule initialization can only resolve the isolated DB before the provider override.
    Object.assign(process.env, isolated);
    const { AppModule } = await import('../../src/app.module.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService(config)).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
    const login = await request(app.getHttpServer()).post('/api/auth/login').set('Origin', origin)
      .send({ username: `latency_${randomBytes(8).toString('hex')}` }).expect(201);
    const parsed = z.object({ user: z.object({ id: z.string() }) }).parse(login.body);
    ownerId = parsed.user.id;
    const cookies = z.union([z.string(), z.array(z.string())]).parse(login.headers['set-cookie']);
    cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(';')[0] ?? '';
    if (!cookie) throw new Error('synthetic login did not return a cookie');
  }, 30_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it.each([
    { name: 'attempt endpoints', mode: 'attempt', message: 'x=1和x=3', verdict: undefined },
    { name: 'reject endpoint-only solution', mode: 'finish_problem', message: '最终解集为 x=1 或 x=3。', verdict: 'incorrect' },
    { name: 'accept open interval solution', mode: 'finish_problem', message: '解集是 1<x<3，因为只有分子与分母异号时分式小于零，两个端点都不能取。', verdict: 'correct' },
  ] as const)('$name returns a committed, guarded reply instead of timeout/fallback', async (testCase) => {
    if (!app || !db) throw new Error('isolated application unavailable');
    const learning = app.get(LearningSessionService);
    const session = await learning.createSession({ ownerId, analysis, content: problemMd, problemMd, title: `synthetic ${testCase.name}` });
    const started = Date.now();
    const response = await request(app.getHttpServer()).post('/api/problems/chat')
      .set('Origin', origin).set('Cookie', cookie).send({
        assistanceMode: testCase.mode, expectedVersion: session.version, history: [], message: testCase.message,
        problemMd, requestId: randomUUID(), sessionId: session.id,
      }).expect(200);
    const elapsedMs = Date.now() - started;
    const events = eventsFrom(response.text);
    const reply = events.filter((event) => event.event === 'chunk').map((event) => String(event.data.text ?? '')).join('');
    const done = events.find((event) => event.event === 'done');
    const error = events.find((event) => event.event === 'error');
    const nodes = await app.get(DatabaseService).client.selectFrom('node_runs')
      .innerJoin('runs', 'runs.id', 'node_runs.run_id')
      .select(['node_runs.node_key', 'node_runs.status', 'node_runs.model_id', 'node_runs.usage_json', 'node_runs.output_json'])
      .where('runs.session_id', '=', session.id).orderBy('node_runs.id', 'asc').execute();
    const summaries = nodes.map((node) => ({
      node: node.node_key, status: node.status, model: node.model_id,
      usage: jsonValue(node.usage_json),
      ...(node.node_key === 'strategy' && node.status === 'completed'
        ? { strategy: z.object({ action: z.string(), scaffold_level: z.number() }).parse(jsonValue(node.output_json)) } : {}),
      ...(node.node_key === 'guard' && node.status === 'completed' ? { guard: z.object({ verdict: z.string() }).parse(jsonValue(node.output_json)).verdict } : {}),
    }));
    // Only the synthetic public reply and non-content audit metadata enter the evidence log.
    console.log(JSON.stringify({ case: testCase.name, elapsedMs, eventTypes: [...new Set(events.map((event) => event.event))], error: error?.data,
      verdict: done?.data.currentVerdict, nodes: summaries, checkedPublicReply: reply }));
    expect(error).toBeUndefined();
    expect(elapsedMs).toBeLessThan(90_000);
    expect(done).toBeDefined();
    expect(reply.trim().length).toBeGreaterThan(0);
    expect(nodes.map((node) => node.node_key)).toEqual(['diagnosis', 'strategy', 'renderer', 'guard']);
    expect(nodes.every((node) => node.status === 'completed')).toBe(true);
    for (const node of summaries) {
      const usage = z.object({ elapsedMs: z.number(), reasoningEffort: z.literal('none'), outputVerbosity: z.literal('low'), latencyProfileVersion: z.literal('interactive-v1') }).parse(node.usage);
      expect(usage.elapsedMs).toBeLessThan(25_000);
    }
    expect(summaries.find((node) => node.node === 'guard')?.guard).toBe('accept');
    if (testCase.verdict) expect(done?.data.currentVerdict).toBe(testCase.verdict);
    const restored = await request(app.getHttpServer()).get(`/api/learning/sessions/${session.id}`).set('Cookie', cookie).expect(200);
    expect(JSON.stringify(restored.body)).toContain(JSON.stringify(reply).slice(1, -1));
    expect(done?.data.version).toBe(session.version + 1);
  }, 100_000);
});
