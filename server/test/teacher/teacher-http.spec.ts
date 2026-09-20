import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeacherModule } from '../../src/features/teacher/teacher.module.js';
import type { TeacherStorePort, TraceCommit } from '../../src/features/teacher/teacher.port.js';
import type { SessionState } from '../../src/contracts/domain.schema.js';

const origin = 'https://qisi.test';
const credential = 'synthetic-credential-not-for-production';
const token = 'x'.repeat(43);
describe('B06 teacher HTTP boundary (Nest + fake store, not MySQL)', () => {
 let app: INestApplication;
 let store: TeacherStorePort;
 let body: { session_id: string; expected_version: number; request_id: string; confirm_exposure: boolean };
 beforeEach(async () => {
  const state = JSON.parse(readFileSync(new URL('../../../qisi-sdd-v3/fixtures/session.json', import.meta.url), 'utf8')) as SessionState;
  const receipt: TraceCommit = { sessionId: state.id, taskId: state.active_task_id, version: state.version + 1, exposure: { taskId: state.active_task_id, scope: 'whole_task', committed: true }, traces: state.traces, runs: [] };
  store = { consumeLoginAttempt: vi.fn(async () => true), createTeacherSession: vi.fn(async () => {}), revokeTeacherSession: vi.fn(async () => {}), findTeacherSession: vi.fn(async () => ({ teacherId: 'teacher', expiresAt: '2099-01-01T00:00:00Z' })), openTraceChecked: vi.fn(async () => receipt) };
  const module = await Test.createTestingModule({ imports: [TeacherModule.register(store, { origin, secureCookie: true, teacherId: 'teacher', credentialSha256: createHash('sha256').update(credential).digest('hex') })] }).compile();
  app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); await app.init();
  body = { session_id: state.id, expected_version: state.version, request_id: 'http-test', confirm_exposure: true };
 });
 afterEach(async () => { await app?.close(); });
 it('issues only the distinct HttpOnly, Secure teacher cookie', async () => {
  const result = await request(app.getHttpServer()).post('/api/teacher/login').set('Origin', origin).send({ credential }).expect(200);
  expect(result.body).toEqual({ authenticated: true });
  const cookies = result.headers['set-cookie'] as unknown as string[];
  expect(cookies).toHaveLength(1); expect(cookies[0]).toMatch(/^qisi_teacher=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/teacher', 'Max-Age=900']) expect(cookies[0]).toContain(flag);
  expect(result.headers['cache-control']).toBe('no-store');
 });
 it('does not allow GET prefetch or trace without the teacher cookie', async () => {
  await request(app.getHttpServer()).get('/api/teacher/trace').expect(404);
  await request(app.getHttpServer()).post('/api/teacher/trace').set('Origin', origin).send(body).expect(401);
  expect(store.openTraceChecked).not.toHaveBeenCalled();
 });
 it('rejects cross-origin posts and body-owner injection before exposure', async () => {
  await request(app.getHttpServer()).post('/api/teacher/trace').set('Origin', 'https://evil.test').set('Cookie', `qisi_teacher=${token}`).send(body).expect(403);
  await request(app.getHttpServer()).post('/api/teacher/trace').set('Origin', origin).set('Cookie', `qisi_teacher=${token}`).send({ ...body, owner_id: 'victim' }).expect(400);
  expect(store.openTraceChecked).not.toHaveBeenCalled();
 });
 it('returns only the projection after a successful exposure commit', async () => {
  const response = await request(app.getHttpServer()).post('/api/teacher/trace').set('Origin', origin).set('Cookie', `qisi_teacher=${token}`).send(body).expect(200);
  expect(response.headers['cache-control']).toBe('no-store'); expect(response.body.exposure).toBe('whole_task');
  expect(JSON.stringify(response.body)).not.toMatch(/credential|system_prompt|lease_token|route_patch/);
  expect(store.openTraceChecked).toHaveBeenCalledOnce();
 });
 it('does not send private errors or trace data after a failed commit', async () => {
  vi.mocked(store.openTraceChecked).mockRejectedValue(new Error('PRIVATE_DATABASE_CONTEXT'));
  const response = await request(app.getHttpServer()).post('/api/teacher/trace').set('Origin', origin).set('Cookie', `qisi_teacher=${token}`).send(body).expect(500);
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_|shown_text_md|evidence/);
 });
 it('revokes the hash and clears the teacher cookie on logout', async () => {
  const response = await request(app.getHttpServer()).post('/api/teacher/logout').set('Origin', origin).set('Cookie', `qisi_teacher=${token}`).send().expect(200);
  expect(store.revokeTeacherSession).toHaveBeenCalledWith(createHash('sha256').update(token).digest('hex'));
  expect(response.headers['set-cookie'][0]).toContain('qisi_teacher=;');
 });
});
