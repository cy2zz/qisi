import { describe, expect, it } from 'vitest';
import { getAssessmentNextAction } from './assessment-next-action';

const completedOriginal = 'completed_without_recorded_help' as const;

describe('assessment next action', () => {
  it('keeps an unfinished original problem ahead of independent assessment', () => {
    expect(getAssessmentNextAction('12', 'incomplete', null)).toMatchObject({
      href: '/study?session=12',
      kind: 'finish_original',
      label: '回原题修正结论',
    });
  });

  it('starts a different-task check only after the original problem is ready', () => {
    expect(getAssessmentNextAction('12', completedOriginal, null)).toMatchObject({
      href: '/learn/12/check',
      kind: 'start',
      label: '去做一次不同新题检验',
    });
  });

  it('resumes an unfinished attempt without creating another task', () => {
    expect(getAssessmentNextAction('12', completedOriginal, {
      execution: 'unanswered',
      independentTaskPass: false,
      phase: 'check_answer',
      planning: 'correct',
    })).toMatchObject({
      href: '/learn/12/check',
      kind: 'resume',
      label: '继续当前独立检验',
    });
  });

  it('routes a planning failure back to method remediation', () => {
    expect(getAssessmentNextAction('12', completedOriginal, {
      execution: 'incorrect',
      independentTaskPass: false,
      phase: 'summary',
      planning: 'incorrect',
    })).toMatchObject({
      href: '/study?session=12&remediate=method',
      kind: 'remediate_method',
      label: '回学习页梳理方法',
    });
  });

  it('routes a correct plan with execution failure to execution remediation', () => {
    expect(getAssessmentNextAction('12', completedOriginal, {
      execution: 'unknown',
      independentTaskPass: false,
      phase: 'summary',
      planning: 'correct',
    })).toMatchObject({
      href: '/study?session=12&remediate=execution',
      kind: 'remediate_execution',
      label: '回学习页处理执行卡点',
    });
  });

  it('explains the evidence boundary when correct work is not independently eligible', () => {
    expect(getAssessmentNextAction('12', completedOriginal, {
      assistanceRequested: true,
      execution: 'correct',
      independentTaskPass: false,
      phase: 'summary',
      planning: 'correct',
    })).toMatchObject({
      href: '/study?session=12&remediate=evidence',
      kind: 'evidence_boundary',
      label: '查看证据边界',
    });
  });

  it('offers a different new task after a near-transfer pass without claiming retention', () => {
    const action = getAssessmentNextAction('12', completedOriginal, {
      execution: 'correct',
      independentTaskPass: true,
      phase: 'summary',
      planning: 'correct',
    });

    expect(action).toMatchObject({
      href: '/learn/12/check?intent=reassess',
      kind: 'reassess',
      label: '再测一道不同新题',
    });
    expect(action.description).toContain('长期保持尚未验证');
    expect(action.description).not.toMatch(/已经掌握|掌握率|\d+%/);
  });
});
