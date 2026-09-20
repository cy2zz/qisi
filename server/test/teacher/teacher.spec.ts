import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TeacherService } from '../../src/features/teacher/teacher.service.js';
import type { TeacherStorePort, TraceCommit } from '../../src/features/teacher/teacher.port.js';
import type { SessionState } from '../../src/contracts/domain.schema.js';
const token = 'x'.repeat(43);
function setup() {
 const state = JSON.parse(readFileSync(new URL('../../../qisi-sdd-v3/fixtures/session.json', import.meta.url), 'utf8')) as SessionState;
 const receipt: TraceCommit = { sessionId: state.id, taskId: state.active_task_id, version: state.version + 1, exposure: { taskId: state.active_task_id, scope: 'whole_task', committed: true }, traces: [...state.traces, { ...state.traces[0]!, task_id: 'future-task', shown_text_md: 'PRIVATE_FUTURE_ANSWER' }], runs: [] };
 const store: TeacherStorePort = {
  consumeLoginAttempt: vi.fn(async () => true), createTeacherSession: vi.fn(async () => {}), revokeTeacherSession: vi.fn(async () => {}),
  findTeacherSession: vi.fn(async () => ({ teacherId: 'teacher-1', expiresAt: '2099-01-01T00:00:00Z' })),
  openTraceChecked: vi.fn(async () => receipt),
 };
 const service = new TeacherService(store, { origin: 'https://qisi.test', secureCookie: true, credentialSha256: createHash('sha256').update('a'.repeat(32)).digest('hex'), teacherId: 'teacher-1' });
 const input = { session_id: state.id, expected_version: state.version, request_id: 'trace-1', confirm_exposure: true };
 return { service, store, input, receipt };
}
describe('B06 explicit teacher exposure boundary (fake persistence)', () => {
 it('opens only after commit and excludes future tasks / private raw fields', async () => {
  const { service, store, input, receipt } = setup(); Object.assign(receipt.traces[0]!, { cot: 'PRIVATE_COT', system_prompt: 'PRIVATE_PROMPT' });
  const result = await service.openTrace(input, token, 'https://qisi.test');
  expect(store.openTraceChecked).toHaveBeenCalledOnce(); expect(result.task_id).toBe(receipt.taskId);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|lease_token|request_id|route_patch/);
 });
 it.each(['origin', 'cookie', 'confirmation', 'owner-spoof'] as const)('rejects %s before any exposure', async kind => {
  const { service, store, input } = setup();
  const body = kind === 'confirmation' ? { ...input, confirm_exposure: false } : kind === 'owner-spoof' ? { ...input, owner_id: 'victim' } : input;
  await expect(service.openTrace(body, kind === 'cookie' ? undefined : token, kind === 'origin' ? 'https://evil.test' : 'https://qisi.test')).rejects.toThrow();
  expect(store.openTraceChecked).not.toHaveBeenCalled();
 });
 it('does not return a trace when durable exposure fails', async () => {
  const { service, store, input } = setup(); vi.mocked(store.openTraceChecked).mockRejectedValue(new Error('transaction failed'));
  await expect(service.openTrace(input, token, 'https://qisi.test')).rejects.toThrow();
 });
 it('rejects an expired teacher cookie', async () => {
  const { service, store, input } = setup(); vi.mocked(store.findTeacherSession).mockResolvedValue({ teacherId: 'teacher-1', expiresAt: '2020-01-01T00:00:00Z' });
  await expect(service.openTrace(input, token, 'https://qisi.test')).rejects.toThrow(); expect(store.openTraceChecked).not.toHaveBeenCalled();
 });
});

describe('B06 teacher login boundary', () => {
 it('persists only hash and limits cookie lifetime', async () => {
  const { service, store } = setup(); const login = await service.login({ credential: 'a'.repeat(32) }, 'https://qisi.test', '127.0.0.1');
  expect(login.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(login.maxAge).toBe(900000);
  expect(vi.mocked(store.createTeacherSession).mock.calls[0]![0]).toBe(createHash('sha256').update(login.token).digest('hex'));
 });
 it('does not create sessions after a persistent throttle denial', async () => {
  const { service, store } = setup(); vi.mocked(store.consumeLoginAttempt).mockResolvedValue(false);
  await expect(service.login({ credential: 'a'.repeat(32) }, 'https://qisi.test', '127.0.0.1')).rejects.toThrow();
  expect(store.createTeacherSession).not.toHaveBeenCalled();
 });
 it('rejects invalid credential without echo', async () => {
  const { service, store } = setup(); await expect(service.login({ credential: 'wrong'.repeat(10) }, 'https://qisi.test', '127.0.0.1')).rejects.toThrow('teacher authentication required');
  expect(store.createTeacherSession).not.toHaveBeenCalled();
 });
 it('rejects an uncommitted/mismatched task receipt', async () => {
  const { service, input, receipt } = setup(); receipt.exposure.taskId = 'other';
  await expect(service.openTrace(input, token, 'https://qisi.test')).rejects.toThrow('invalid trace commit');
 });
});
