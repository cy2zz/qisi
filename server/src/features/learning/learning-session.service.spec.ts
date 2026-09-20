import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { DatabaseService } from '../../database/database.service.js';
import {
  LearningSessionService,
  remediationTrackAfterTurn,
  restoreTutorTeachingState,
} from './learning-session.service.js';

const approvedRoutePatch = {
  blocking_issues: [],
  evidence_refs: [{ quote: '我用均值不等式。', revision: 1, submission_id: 'turn-2' }],
  math_status: 'valid' as const,
  new_decisions: [{
    acceptance_rule: '均值不等式与取等条件正确。',
    common_gaps: ['漏写取等条件'],
    entry_condition: '学生提出均值不等式路线。',
    expected_artifact: '求得最小值并写出取等条件。',
    goal: '沿学生路线求最小值',
    goal_key: 'session-91:student-route:am-gm',
    id: 'session-91:student-route:am-gm',
    parent_goal_key: 'session-91:target',
    part_id: 'session-91',
    prerequisite_ids: ['session-91:conditions'],
    source: 'student' as const,
  }],
  new_routes: [{
    decision_ids: ['session-91:conditions', 'session-91:student-route:am-gm'],
    evidence_refs: [{ quote: '我用均值不等式。', revision: 1, submission_id: 'turn-2' }],
    id: 'session-91:student-am-gm-route',
    math_status: 'valid' as const,
    note: '已核对的学生路线。',
    source: 'student' as const,
    terminal_ids: ['session-91:student-route:am-gm'],
  }],
  task_id: 'session-91',
  verification: [{
    checked_at: '2026-09-20T00:00:00.000Z',
    kind: 'model_checked' as const,
    reference: '学生已确认输入',
    reviewer_or_model: 'fixture-model',
    status: 'pass' as const,
    summary: '均值不等式路线成立。',
  }],
};

describe('LearningSessionService', () => {
  it('keeps remediation active across turns and closes it only after a correct final check', () => {
    expect(remediationTrackAfterTurn('execution', 'attempt', undefined)).toBe('execution');
    expect(remediationTrackAfterTurn('execution', 'finish_problem', 'incorrect')).toBe('execution');
    expect(remediationTrackAfterTurn('execution', 'finish_problem', 'unknown')).toBe('execution');
    expect(remediationTrackAfterTurn('execution', 'finish_problem', 'correct')).toBeNull();
    expect(remediationTrackAfterTurn(undefined, 'finish_problem', 'correct')).toBeUndefined();
  });

  it('restores help exposure, probe counts and approved student routes from committed events', () => {
    const teachingState = restoreTutorTeachingState('91', '题目 $x^2=1$', [
      {
        db_create_time: '2026-09-19T12:00:00.000Z',
        event_type: 'help_exposed',
        id: '31',
        payload_json: JSON.stringify({
          assistanceMode: 'hint',
          decisionIds: ['session-91:conditions'],
          wholeTask: false,
        }),
        subject_id: 'turn-1',
      },
      {
        db_create_time: '2026-09-19T12:01:00.000Z',
        event_type: 'diagnostic_probe_shown',
        id: '32',
        payload_json: JSON.stringify({ goalKey: 'session-91:method' }),
        subject_id: 'turn-1',
      },
      {
        db_create_time: '2026-09-19T12:02:00.000Z',
        event_type: 'diagnostic_probe_shown',
        id: '33',
        payload_json: { goalKey: 'session-91:method' },
        subject_id: 'turn-2',
      },
      {
        db_create_time: '2026-09-19T12:03:00.000Z',
        event_type: 'route_patch_approved',
        id: '34',
        payload_json: JSON.stringify({ routePatch: approvedRoutePatch }),
        subject_id: 'turn-2',
      },
      {
        db_create_time: '2026-09-19T12:04:00.000Z',
        event_type: 'route_patch_approved',
        id: '35',
        payload_json: JSON.stringify({
          routePatch: { ...approvedRoutePatch, task_id: 'session-92' },
        }),
        subject_id: 'turn-foreign',
      },
    ]);

    expect(teachingState.exposures).toEqual([
      expect.objectContaining({
        decision_ids: ['session-91:conditions'],
        id: 'event-31',
        reason: 'teacher_hint',
        scope: 'listed_decisions',
        task_id: 'session-91',
        turn_id: 'turn-1',
      }),
    ]);
    expect(teachingState.exposures[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(teachingState.probesShownByGoal).toEqual({ 'session-91:method': 2 });
    expect(teachingState.routePatches).toEqual([approvedRoutePatch]);
  });

  it('returns the authoritative persisted title for a formula problem', async () => {
    const insertedSessions: Array<Record<string, unknown>> = [];
    const transaction = {
      insertInto: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          if (table === 'sessions') insertedSessions.push(values);
          return table === 'sessions'
            ? { executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ insertId: 91 }) }
            : { execute: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    const database = {
      client: {
        transaction: () => ({ execute: (callback: (trx: typeof transaction) => unknown) => callback(transaction) }),
      },
    };
    const service = new LearningSessionService(database as unknown as DatabaseService);

    await expect(service.createSession({
      analysis: {
        firstQuestion: '分母怎样有理化？',
        keyConditions: ['$\\sqrt{3}$ 在分母'],
        knowledgePoints: ['分母有理化'],
        overview: '这是一道二次根式化简题。',
        target: '化简原式。',
      },
      content: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
      ownerId: '7',
      problemMd: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
    })).resolves.toEqual({ id: '91', title: '二次根式化简题', version: 1 });

    expect(insertedSessions[0]?.title).toBe('二次根式化简题');
  });

  it('replays persisted student-route attribution for an idempotent request', async () => {
    const input = {
      assistanceMode: 'attempt' as const,
      expectedVersion: 1,
      message: '我用均值不等式求最小值。',
      ownerId: '7',
      requestId: '11111111-1111-4111-8111-111111111111',
      sessionId: '91',
    };
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({
        assistanceMode: input.assistanceMode,
        expectedVersion: input.expectedVersion,
        message: input.message,
        sessionId: input.sessionId,
      }))
      .digest();
    function query(result: unknown) {
      const builder = {
        executeTakeFirst: vi.fn().mockResolvedValue(result),
        forUpdate: vi.fn(),
        select: vi.fn(),
        selectAll: vi.fn(),
        where: vi.fn(),
      };
      builder.forUpdate.mockReturnValue(builder);
      builder.select.mockReturnValue(builder);
      builder.selectAll.mockReturnValue(builder);
      builder.where.mockReturnValue(builder);
      return builder;
    }
    const sessionQuery = query({ expires_at: new Date(Date.now() + 60_000) });
    const requestQuery = query({
      payload_hash: payloadHash,
      safe_response_json: JSON.stringify({
        reply: '你的均值不等式路线成立；继续补充单调性。',
        routeAttribution: 'student',
        version: 2,
      }),
      status: 'succeeded',
    });
    const transaction = {
      selectFrom: vi.fn((table: string) => (
        table === 'sessions' ? sessionQuery : requestQuery
      )),
    };
    const database = {
      client: {
        transaction: () => ({
          execute: (callback: (trx: typeof transaction) => unknown) => callback(transaction),
        }),
      },
    };
    const service = new LearningSessionService(database as unknown as DatabaseService);

    await expect(service.reserveTurn(input)).resolves.toEqual({
      kind: 'replay',
      reply: '你的均值不等式路线成立；继续补充单调性。',
      routeAttribution: 'student',
      version: 2,
    });
  });

  it('commits an approved route patch privately while keeping the replay response safe', async () => {
    const inserted: Record<string, unknown> = {};
    const updated: Record<string, unknown> = {};
    function query(result: unknown) {
      const builder = {
        executeTakeFirst: vi.fn().mockResolvedValue(result),
        forUpdate: vi.fn(),
        select: vi.fn(),
        selectAll: vi.fn(),
        where: vi.fn(),
      };
      builder.forUpdate.mockReturnValue(builder);
      builder.select.mockReturnValue(builder);
      builder.selectAll.mockReturnValue(builder);
      builder.where.mockReturnValue(builder);
      return builder;
    }
    function insertion(table: string) {
      const builder = {
        execute: vi.fn().mockResolvedValue(undefined),
        values: vi.fn((value: unknown) => {
          inserted[table] = value;
          return builder;
        }),
      };
      return builder;
    }
    function update(table: string) {
      const builder = {
        execute: vi.fn().mockResolvedValue(undefined),
        executeTakeFirstOrThrow: vi.fn().mockResolvedValue(undefined),
        set: vi.fn((value: unknown) => {
          updated[table] = value;
          return builder;
        }),
        where: vi.fn(),
      };
      builder.where.mockReturnValue(builder);
      return builder;
    }
    function deletion() {
      const builder = {
        execute: vi.fn().mockResolvedValue(undefined),
        where: vi.fn(),
      };
      builder.where.mockReturnValue(builder);
      return builder;
    }
    const transaction = {
      deleteFrom: vi.fn(() => deletion()),
      insertInto: vi.fn((table: string) => insertion(table)),
      selectFrom: vi.fn((table: string) => query(
        table === 'sessions'
          ? {
              active_run_id: 'run-1',
              expires_at: new Date(Date.now() + 60_000),
              next_event_seq: 5,
              next_message_seq: 3,
              version: 1,
            }
          : table === 'runs'
            ? {
                deadline_at: new Date(Date.now() + 60_000),
                lease_token: 'lease-token',
                request_id: '11111111-1111-4111-8111-111111111111',
                reserved_version: 1,
                session_id: '91',
                status: 'active',
              }
            : undefined,
      )),
      updateTable: vi.fn((table: string) => update(table)),
    };
    const database = {
      client: {
        transaction: () => ({
          execute: (callback: (trx: typeof transaction) => unknown) => callback(transaction),
        }),
      },
    };
    const service = new LearningSessionService(database as unknown as DatabaseService);

    await expect(service.commitTurn({
      assistanceMode: 'attempt',
      expectedVersion: 1,
      leaseToken: 'lease-token',
      message: '我用均值不等式求最小值。',
      ownerId: '7',
      reply: '你的最值路线成立；继续补充单调性。',
      requestId: '11111111-1111-4111-8111-111111111111',
      routeAttribution: 'student',
      routePatch: approvedRoutePatch,
      runId: 'run-1',
      sessionId: '91',
    })).resolves.toEqual({
      reply: '你的最值路线成立；继续补充单调性。',
      routeAttribution: 'student',
      version: 2,
    });

    const messages = inserted.learning_messages as Array<{ metadata_json: string | null; role: string }>;
    const guideMetadata = JSON.parse(messages.find((message) => message.role === 'guide')!.metadata_json!);
    expect(guideMetadata).toEqual({ routeAttribution: 'student' });
    expect(guideMetadata).not.toHaveProperty('routePatch');
    const events = inserted.events as Array<{ event_type: string; payload_json: string }>;
    const routeEvent = events.find((event) => event.event_type === 'route_patch_approved');
    expect(JSON.parse(routeEvent!.payload_json)).toEqual({ routePatch: approvedRoutePatch });
    const replayResponse = JSON.parse((updated.requests as { safe_response_json: string }).safe_response_json);
    expect(replayResponse).toEqual({
      reply: '你的最值路线成立；继续补充单调性。',
      routeAttribution: 'student',
      version: 2,
    });
    expect(replayResponse).not.toHaveProperty('routePatch');
  });
});
