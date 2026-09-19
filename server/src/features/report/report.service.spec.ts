import { describe, expect, it } from 'vitest';
import { buildAttemptReport, deriveOriginalStatus } from './report.service.js';

const baseAttempt = {
  assistanceRequested: false,
  execution: 'incorrect' as const,
  finished: true,
  firstSeenEligible: true,
  helpExposed: false,
  invalidated: false,
  planning: 'correct' as const,
  relation: 'near_transfer' as const,
};

describe('report evidence rules', () => {
  it('reports planning and execution separately without upgrading the whole task', () => {
    const report = buildAttemptReport(baseAttempt);

    expect(report).toMatchObject({
      independentExecution: false,
      independentPlanning: true,
      independentTaskPass: false,
    });
  });

  it('keeps requested-but-not-exposed help disqualified with the real reason', () => {
    const report = buildAttemptReport({
      ...baseAttempt,
      assistanceRequested: true,
      execution: 'correct',
    });

    expect(report.independentPlanning).toBe(false);
    expect(report.independentExecution).toBe(false);
    expect(report.limitations.join('')).toContain('请求过帮助');
    expect(report.limitations.join('')).toContain('尚未成功发出');
  });

  it('never treats unknown, unanswered, invalidated, or unfinished work as independent evidence', () => {
    for (const attempt of [
      { ...baseAttempt, execution: 'unknown' as const },
      { ...baseAttempt, execution: 'unanswered' as const },
      { ...baseAttempt, execution: 'correct' as const, invalidated: true },
      { ...baseAttempt, execution: 'correct' as const, finished: false },
    ]) {
      expect(buildAttemptReport(attempt).independentTaskPass).toBe(false);
    }
  });

  it('derives original completion only from the persisted checked verdict', () => {
    expect(deriveOriginalStatus(null, false)).toBe('in_progress');
    expect(deriveOriginalStatus('unknown', false)).toBe('unknown');
    expect(deriveOriginalStatus('incorrect', false)).toBe('incomplete');
    expect(deriveOriginalStatus('correct', false)).toBe('completed_without_recorded_help');
    expect(deriveOriginalStatus('correct', true)).toBe('completed_with_help');
  });
});
