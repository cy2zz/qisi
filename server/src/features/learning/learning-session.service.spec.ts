import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../../database/database.service.js';
import {
  LearningSessionService,
  restoreTutorTeachingState,
} from './learning-session.service.js';

describe('LearningSessionService', () => {
  it('restores irreversible help exposure and probe counts from committed events', () => {
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
});
