import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../src/features/auth/auth.service.js';
import { TutorController } from '../../src/features/tutor/tutor.controller.js';
import { TutorService, type TutorSession } from '../../src/features/tutor/tutor.service.js';
import { projectStudentView } from '../../src/features/tutor/student-view.js';
import { PacketSchema, TurnInputSchema } from '../../src/contracts/domain.schema.js';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8'));
const packet = PacketSchema.parse(read('packet'));
const session: TutorSession = {
  id: '91', version: 1, phase: 'study', problem: read('problem'), packetVersion: packet.version,
  decisions: packet.decisions, routes: packet.routes, referenceMd: packet.reference_md,
  checkTask: packet.check_tasks[0] ?? null, messages: [], currentGoalKey: null, attempt: null,
  notice: '', canStartCheck: false,
};
const input = TurnInputSchema.parse({ session_id: '91', expected_version: 1, request_id: 'req-1', action: 'attempt', text_md: '先求导数', transcript_id: null, transcript_revision: null });
const savedView = projectStudentView({ sessionId: '91', version: 2, phase: 'study', problem: session.problem, activeTaskPromptMd: session.problem.statement_md, messages: [{id:'teacher-req-1',role:'teacher',text_md:'请先说明求导依据',created_at:'2026-09-20T00:00:00.000Z'}], decisions: session.decisions, currentGoalKey: null, attempt: null, notice: '', runStatus: 'idle', canStartCheck: false });

function harness(version = 1) {
  const sessions = { load: vi.fn().mockResolvedValue({ ...session, version }), save: vi.fn().mockResolvedValue(true) };
  const runTurn = vi.fn().mockResolvedValue({status:'committed', textMd:'请先说明求导依据', notice:'', studentView:savedView});
  const service = new TutorService({sessions, runTurn, atomicPersistence:true} as ConstructorParameters<typeof TutorService>[0]);
  return { sessions, runTurn, service };
}

describe('A/B persistent turn application boundary (fixture, no MySQL)', () => {
  it('passes authenticated owner through controller and session read', async () => {
    const h = harness();
    const spy = vi.spyOn(h.service, 'submitTurn');
    const auth = { authenticate: vi.fn().mockResolvedValue({ id:'7' }) } as unknown as AuthService;
    const config = { get: () => 'https://qisi.test' } as unknown as ConstructorParameters<typeof TutorController>[1];
    const controller = new TutorController(auth, config, h.service);
    await controller.submitTurn(input, undefined, 'https://qisi.test');
    expect(spy).toHaveBeenCalledWith(input, '7');
    expect(h.sessions.load).toHaveBeenCalledWith('91', '7');
  });

  it('returns the transaction-persisted response without a second version/message save', async () => {
    const h = harness();
    const result = await h.service.submitTurn(input);
    expect(h.sessions.save).not.toHaveBeenCalled();
    expect(result).toEqual(savedView);
  });

  it('allows transaction-level request replay before stale-version rejection', async () => {
    const h = harness(3);
    await expect(h.service.submitTurn(input)).resolves.toEqual(savedView);
    expect(h.runTurn).toHaveBeenCalledOnce();
    expect(h.sessions.save).not.toHaveBeenCalled();
  });
});
