import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ModelPort, ModelResponse } from '../../model/model.port.js';
import type {
  AssessmentAttemptRecord,
  AssessmentRepository,
} from './assessment.repository.js';
import { AssessmentService } from './assessment.service.js';

function response(parsed: unknown): ModelResponse {
  return {
    elapsedMs: 8,
    model: 'fixture-math',
    parsed,
    provider: 'fixture',
    providerRequestId: 'fixture-request',
    usage: { input: 20, kind: 'reported', output: 10 },
  };
}

function attempt(overrides: Partial<AssessmentAttemptRecord> = {}): AssessmentAttemptRecord {
  return {
    answerDraftMarkdown: '',
    assistanceRequested: false,
    equivalenceGroup: 'quadratic-minimum-by-completing-square',
    finalAnswerMarkdown: null,
    firstSeenEligible: true,
    helpExposed: false,
    helpSessionId: null,
    id: '81',
    invalidated: false,
    lockedPlanMarkdown: null,
    phase: 'check_plan',
    planDraftMarkdown: '',
    planUnanswered: false,
    promptMarkdown: '求函数 $g(x)=x^2-6x+5$ 的最小值。',
    referenceAnswerMarkdown: '$g(x)=(x-3)^2-4$，最小值为 $-4$。',
    relation: 'near_transfer',
    result: null,
    rubric: ['识别二次函数开口向上', '通过配方得到顶点与最小值'],
    sessionId: '12',
    taskId: '61',
    version: 1,
    ...overrides,
  };
}

function setup() {
  const repository = {
    createAttempt: vi.fn(),
    createReassessment: vi.fn(),
    freezeAnswer: vi.fn(),
    getActiveReassessment: vi.fn(),
    getCurrentAttempt: vi.fn(),
    getReassessmentHistory: vi.fn().mockResolvedValue([]),
    getSourceSession: vi.fn().mockResolvedValue({
      analysis: {
        keyConditions: ['二次项系数为正'],
        knowledgePoints: ['配方法', '二次函数最值'],
        overview: '二次函数最值题',
        target: '求最小值',
      },
      problemMarkdown: '求 $f(x)=x^2-4x$ 的最小值。',
      questionId: null,
    }),
    lockPlan: vi.fn(),
    isTaskSeen: vi.fn(),
    requestHelp: vi.fn(),
    saveDraft: vi.fn(),
    saveGrade: vi.fn(),
  } as unknown as AssessmentRepository;
  const model = { generate: vi.fn() } as unknown as ModelPort;
  return {
    model,
    repository,
    service: new AssessmentService(repository, model),
  };
}

describe('AssessmentService', () => {
  it('generates and independently reviews a near-transfer task without exposing the rubric', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getCurrentAttempt).mockRejectedValue(new NotFoundException());
    vi.mocked(model.generate)
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'quadratic-minimum-by-completing-square-v2',
        promptMarkdown: '求函数 $g(x)=x^2-6x+5$ 的最小值。',
        referenceAnswerMarkdown: '$g(x)=(x-3)^2-4$，最小值为 $-4$。',
        relation: 'near_transfer',
        rubric: ['使用配方法', '给出最小值'],
      }))
      .mockResolvedValueOnce(response({ reason: '条件、答案与迁移关系可核对', verdict: 'accept' }));
    vi.mocked(repository.createAttempt).mockResolvedValue(attempt());

    const result = await service.start('7', '12');

    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(model.generate).mock.calls.map(([request]) => request.role)).toEqual([
      'preparation',
      'guard',
    ]);
    expect(repository.createAttempt).toHaveBeenCalledWith(
      '7',
      '12',
      expect.objectContaining({ taskHash: expect.any(Buffer) }),
    );
    expect(result.attempt).not.toHaveProperty('referenceAnswerMarkdown');
    expect(result.attempt).not.toHaveProperty('rubric');
    expect(result.attempt.promptMarkdown).toContain('g(x)');
  });

  it('does not persist a generated task rejected by the independent review', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getCurrentAttempt).mockRejectedValue(new NotFoundException());
    vi.mocked(model.generate)
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'same-task',
        promptMarkdown: '求 $f(x)=x^2-4x$ 的最小值。',
        referenceAnswerMarkdown: '最小值为 $-4$。',
        relation: 'near_transfer',
        rubric: ['给出答案'],
      }))
      .mockResolvedValueOnce(response({ reason: '只是原题改写', verdict: 'reject' }))
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'same-task-again',
        promptMarkdown: '求 $g(x)=x^2-6x+5$ 的最小值。',
        referenceAnswerMarkdown: '最小值为 $-4$。',
        relation: 'near_transfer',
        rubric: ['给出答案'],
      }))
      .mockResolvedValueOnce(response({ reason: '仍然只是更换数字', verdict: 'reject' }));

    await expect(service.start('7', '12')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_READY' }),
    });
    expect(model.generate).toHaveBeenCalledTimes(4);
    expect(repository.createAttempt).not.toHaveBeenCalled();
  });

  it('uses the second bounded candidate when the first initial task is a near duplicate', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getCurrentAttempt).mockRejectedValue(new NotFoundException());
    vi.mocked(model.generate)
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'renamed-only',
        promptMarkdown: '求 $g(x)=x^2-6x+5$ 的最小值。',
        referenceAnswerMarkdown: '最小值为 $-4$。',
        relation: 'near_transfer',
        rubric: ['给出答案'],
      }))
      .mockResolvedValueOnce(response({ reason: '只换了变量和数字', verdict: 'reject' }))
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'quadratic-minimum-from-linear-constraint',
        promptMarkdown: '已知 $x+y=4$，求 $x^2+y^2$ 的最小值。',
        referenceAnswerMarkdown: '代入 $y=4-x$ 后配方，最小值为 $8$。',
        relation: 'near_transfer',
        rubric: ['化为一元二次式', '配方求最小值'],
      }))
      .mockResolvedValueOnce(response({ reason: '表征和前置决策已改变', verdict: 'accept' }));
    vi.mocked(repository.createAttempt).mockResolvedValue(attempt({
      promptMarkdown: '已知 $x+y=4$，求 $x^2+y^2$ 的最小值。',
    }));

    const result = await service.start('7', '12');

    expect(model.generate).toHaveBeenCalledTimes(4);
    expect(result.attempt.promptMarkdown).toContain('x+y=4');
    expect(repository.createAttempt).toHaveBeenCalledTimes(1);
  });

  it('skips an equivalent reassessment candidate and persists the next distinct task', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getActiveReassessment).mockResolvedValue(null);
    vi.mocked(repository.getCurrentAttempt).mockResolvedValue(attempt({ phase: 'summary' }));
    vi.mocked(repository.isTaskSeen)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.mocked(model.generate)
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'quadratic-minimum-by-completing-square',
        promptMarkdown: '求函数 $p(x)=x^2-8x+7$ 的最小值。',
        referenceAnswerMarkdown: '最小值为 $-9$。',
        relation: 'near_transfer',
        rubric: ['使用配方法', '给出最小值'],
      }))
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'quadratic-vertex-from-graph-interpretation',
        promptMarkdown: '抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？',
        referenceAnswerMarkdown: '$y=(x-5)^2-4$，顶点纵坐标为 $-4$。',
        relation: 'near_transfer',
        rubric: ['建立顶点式', '给出顶点纵坐标'],
      }))
      .mockResolvedValueOnce(response({ reason: '表征改变且不是只换数字', verdict: 'accept' }));
    vi.mocked(repository.createReassessment).mockResolvedValue(attempt({
      id: '82',
      phase: 'check_plan',
      promptMarkdown: '抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？',
      sessionId: '13',
      taskId: '62',
    }));

    const result = await service.reassess('7', '12');

    expect(model.generate).toHaveBeenCalledTimes(3);
    expect(vi.mocked(model.generate).mock.calls.map(([request]) => request.role)).toEqual([
      'preparation',
      'preparation',
      'guard',
    ]);
    expect(repository.createReassessment).toHaveBeenCalledWith(
      '7',
      '12',
      expect.objectContaining({
        candidate: expect.objectContaining({
          equivalenceGroup: 'quadratic-vertex-from-graph-interpretation',
        }),
      }),
    );
    expect(result.attempt).toMatchObject({ id: '82', phase: 'check_plan' });
  });

  it('returns NOT_READY after two reassessment candidates fail the distinct-task gate', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getActiveReassessment).mockResolvedValue(null);
    vi.mocked(repository.getCurrentAttempt).mockResolvedValue(attempt({ phase: 'summary' }));
    vi.mocked(repository.isTaskSeen).mockResolvedValue(false);
    vi.mocked(model.generate)
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'renamed-only',
        promptMarkdown: '求函数 $p(x)=x^2-8x+7$ 的最小值。',
        referenceAnswerMarkdown: '最小值为 $-9$。',
        relation: 'near_duplicate',
        rubric: ['给出最小值'],
      }))
      .mockResolvedValueOnce(response({
        equivalenceGroup: 'another-renamed-only',
        promptMarkdown: '求函数 $q(x)=x^2-10x+9$ 的最小值。',
        referenceAnswerMarkdown: '最小值为 $-16$。',
        relation: 'near_transfer',
        rubric: ['给出最小值'],
      }))
      .mockResolvedValueOnce(response({ reason: '仍然只是更换数字', verdict: 'reject' }));

    await expect(service.reassess('7', '12')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_READY' }),
    });
    expect(repository.createReassessment).not.toHaveBeenCalled();
  });

  it('restores an unfinished linked reassessment without another model call', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getActiveReassessment).mockResolvedValue(attempt({
      id: '82',
      phase: 'check_answer',
      sessionId: '13',
    }));

    const result = await service.reassess('7', '12');

    expect(result.attempt).toMatchObject({ id: '82', phase: 'check_answer' });
    expect(repository.getCurrentAttempt).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
  });

  it('scores only after the final answer is frozen and computes independence in code', async () => {
    const { model, repository, service } = setup();
    const frozen = attempt({
      finalAnswerMarkdown: '配方得 $g(x)=(x-3)^2-4$，所以最小值为 $-4$。',
      lockedPlanMarkdown: '先配方，再利用平方项非负。',
      phase: 'grading',
      version: 3,
    });
    vi.mocked(repository.freezeAnswer).mockResolvedValue(frozen);
    vi.mocked(model.generate)
      .mockResolvedValueOnce(response({
        evidence: ['计划明确使用配方', '最终答案给出顶点式和最小值'],
        execution: 'correct',
        planning: 'correct',
        summary: '首次计划与最终执行均有依据。',
      }))
      .mockResolvedValueOnce(response({ reason: '分判与 rubric 一致', verdict: 'accept' }));
    vi.mocked(repository.saveGrade).mockImplementation(async (_owner, _attempt, result) =>
      attempt({ phase: 'summary', result, version: 4 }),
    );

    const result = await service.finish('7', '81', {
      answerMarkdown: frozen.finalAnswerMarkdown!,
      expectedVersion: 2,
    });

    expect(repository.freezeAnswer).toHaveBeenCalledBefore(repository.saveGrade as never);
    expect(result.attempt.result).toMatchObject({
      independentExecution: true,
      independentPlanning: true,
      independentTaskPass: true,
    });
  });

  it('never grants independent credit after assistance was requested', async () => {
    const { model, repository, service } = setup();
    const frozen = attempt({
      assistanceRequested: true,
      finalAnswerMarkdown: '最小值为 $-4$。',
      lockedPlanMarkdown: '配方。',
      phase: 'grading',
    });
    vi.mocked(repository.freezeAnswer).mockResolvedValue(frozen);
    vi.mocked(model.generate)
      .mockResolvedValueOnce(response({
        evidence: ['计划和答案均正确'],
        execution: 'correct',
        planning: 'correct',
        summary: '作答正确。',
      }))
      .mockResolvedValueOnce(response({ reason: '评分本身可核对', verdict: 'accept' }));
    vi.mocked(repository.saveGrade).mockImplementation(async (_owner, _attempt, result) =>
      attempt({ ...frozen, phase: 'summary', result }),
    );

    const result = await service.finish('7', '81', {
      answerMarkdown: frozen.finalAnswerMarkdown!,
      expectedVersion: 2,
    });

    expect(result.attempt.result).toMatchObject({
      independentExecution: false,
      independentPlanning: false,
      independentTaskPass: false,
    });
    expect(result.attempt.result?.limitations.join('')).toContain('请求过帮助');
  });

  it('rejects model-supplied independence fields and computes a conservative result in code', async () => {
    const { model, repository, service } = setup();
    const frozen = attempt({
      finalAnswerMarkdown: '最小值为 $-4$。',
      lockedPlanMarkdown: '配方。',
      phase: 'grading',
    });
    vi.mocked(repository.freezeAnswer).mockResolvedValue(frozen);
    vi.mocked(model.generate).mockResolvedValueOnce(response({
      evidence: ['模型试图越权设置独立通过'],
      execution: 'correct',
      independentTaskPass: true,
      planning: 'correct',
      summary: '模型声称独立通过。',
    }));
    vi.mocked(repository.saveGrade).mockImplementation(async (_owner, _attempt, result) =>
      attempt({ ...frozen, phase: 'summary', result }),
    );

    const result = await service.finish('7', '81', {
      answerMarkdown: frozen.finalAnswerMarkdown!,
      expectedVersion: 2,
    });

    expect(result.attempt.result).toMatchObject({
      execution: 'unknown',
      independentExecution: false,
      independentPlanning: false,
      independentTaskPass: false,
      planning: 'unknown',
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('persists the current draft before ending independent eligibility for help', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.requestHelp).mockResolvedValue(
      attempt({
        assistanceRequested: true,
        phase: 'help_requested',
        planDraftMarkdown: '我准备先配方。',
        version: 2,
      }),
    );

    const result = await service.requestHelp('7', '81', {
      currentMarkdown: '我准备先配方。',
      expectedVersion: 1,
    });

    expect(repository.requestHelp).toHaveBeenCalledWith('7', '81', {
      currentMarkdown: '我准备先配方。',
      expectedVersion: 1,
    });
    expect(model.generate).not.toHaveBeenCalled();
    expect(result.attempt).toMatchObject({ assistanceRequested: true, helpExposed: false });
  });
});
