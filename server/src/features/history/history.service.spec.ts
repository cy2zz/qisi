import { describe, expect, it } from 'vitest';
import { buildHistoryEntry } from './history.service.js';

const base = {
  assistanceRequested: false,
  attempt: null,
  helpModes: [] as string[],
  latestStudentWork: '先配方，再利用平方项非负。',
  originalVerdict: 'correct' as const,
  sessionId: '12',
  title: '二次函数最值',
  topic: '二次函数',
  updatedAt: '2026-09-19T10:00:00.000Z',
};

describe('history evidence projection', () => {
  it('keeps actual help visible beside the student work', () => {
    const entry = buildHistoryEntry({
      ...base,
      assistanceRequested: true,
      helpModes: ['hint', 'worked_solution'],
    });

    expect(entry.original_status).toBe('completed_with_help');
    expect(entry.help).toEqual({
      exposed: true,
      modes: ['hint', 'worked_solution'],
      requested: true,
    });
    expect(entry.latest_student_work_markdown).toContain('先配方');
  });

  it('does not present a near-duplicate task as independent transfer evidence', () => {
    const entry = buildHistoryEntry({
      ...base,
      attempt: {
        assistanceRequested: false,
        execution: 'correct' as const,
        finished: true,
        firstSeenEligible: true,
        helpExposed: false,
        invalidated: false,
        phase: 'summary',
        planning: 'correct' as const,
        relation: 'near_duplicate' as const,
      },
    });

    expect(entry.assessment?.independent_task_pass).toBe(false);
    expect(entry.assessment?.relation).toBe('near_duplicate');
    expect(entry.assessment?.limitations.join('')).toContain('近重复');
  });

  it('keeps unfinished and unknown evidence neutral', () => {
    const entry = buildHistoryEntry({
      ...base,
      latestStudentWork: null,
      originalVerdict: 'unknown',
      attempt: {
        assistanceRequested: false,
        execution: 'unknown' as const,
        finished: false,
        firstSeenEligible: true,
        helpExposed: false,
        invalidated: false,
        phase: 'check_answer',
        planning: 'unanswered' as const,
        relation: 'near_transfer' as const,
      },
    });

    expect(entry.original_status).toBe('unknown');
    expect(entry.latest_student_work_markdown).toBeNull();
    expect(entry.assessment?.independent_task_pass).toBe(false);
  });
});
