import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ModelPort, ModelResponse } from '../../model/model.port.js';
import type { MediaService } from '../media/media.service.js';
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

function preparedCheckTask() {
  return {
    content_hash: 'a'.repeat(64),
    decisions: [{
      acceptance_rule: '配方后正确读出最小值',
      common_gaps: ['忘记利用平方项非负'],
      entry_condition: '能将二次式配方',
      expected_artifact: '顶点式和最小值',
      goal: '用配方法求最值',
      goal_key: 'complete-square-minimum',
      id: 'decision-1',
      parent_goal_key: null,
      part_id: 'part-1',
      prerequisite_ids: [],
      source: 'teacher' as const,
    }],
    equivalence_group: 'quadratic-minimum-from-linear-constraint',
    execution_rubric: '正确化为一元二次式，配方并给出最小值',
    id: 'prepared-check-1',
    planning_rubric: '计划中说明先消元再配方',
    prompt_md: '已知 $x+y=4$，求 $x^2+y^2$ 的最小值。',
    reference_md: '代入 $y=4-x$ 后配方，最小值为 $8$。',
    relation: 'near_transfer' as const,
    routes: [{
      decision_ids: ['decision-1'],
      evidence_refs: [],
      id: 'route-1',
      math_status: 'valid' as const,
      note: '消元后配方',
      source: 'teacher' as const,
      terminal_ids: ['decision-1'],
    }],
    source_problem_id: 'question-1',
    verification: [{
      checked_at: '2026-09-19T00:00:00.000Z',
      kind: 'model_checked' as const,
      reference: 'prepared-check-1',
      reviewer_or_model: 'fixture-preparation',
      status: 'pass' as const,
      summary: '备课候选已做结构检查',
    }],
    verified: false,
  };
}

function setup() {
  const repository = {
    completeModelRun: vi.fn().mockResolvedValue(undefined),
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
      currentAnswerVerdict: 'correct',
      problemMarkdown: '求 $f(x)=x^2-4x$ 的最小值。',
      questionId: null,
    }),
    lockPlan: vi.fn(),
    isTaskSeen: vi.fn(),
    requestHelp: vi.fn(),
    recordModelNode: vi.fn().mockResolvedValue(undefined),
    saveDraft: vi.fn(),
    saveGrade: vi.fn(),
    startModelRun: vi.fn().mockResolvedValue({
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      leaseToken: 'fixture-lease',
      requestId: 'fixture-request-id',
      runId: 'fixture-run-id',
    }),
  } as unknown as AssessmentRepository;
  const model = { generate: vi.fn() } as unknown as ModelPort;
  const media = {
    assertConfirmedTranscript: vi.fn().mockResolvedValue(undefined),
  } as unknown as MediaService;
  return {
    media,
    model,
    repository,
    service: new AssessmentService(repository, model, media),
  };
}

describe('AssessmentService', () => {
  it('validates confirmed handwriting before locking a plan or freezing an answer', async () => {
    const { media, repository, service } = setup();
    vi.mocked(repository.lockPlan).mockResolvedValue(attempt({
      lockedPlanMarkdown: '先配方。',
      phase: 'check_answer',
      planDraftMarkdown: '先配方。',
      version: 2,
    }));
    vi.mocked(repository.freezeAnswer).mockResolvedValue(attempt({
      finalAnswerMarkdown: '$g(x)=(x-3)^2-4$。',
      phase: 'summary',
      version: 4,
    }));

    await service.submitPlan('7', '81', {
      expectedVersion: 1,
      noPlan: false,
      planMarkdown: '  先配方。  ',
      transcriptId: '41',
      transcriptRevision: 2,
    });
    await service.finish('7', '81', {
      answerMarkdown: '  $g(x)=(x-3)^2-4$。  ',
      expectedVersion: 3,
      transcriptId: '42',
      transcriptRevision: 3,
    });

    expect(media.assertConfirmedTranscript).toHaveBeenNthCalledWith(
      1,
      '7',
      '41',
      2,
      '先配方。',
    );
    expect(media.assertConfirmedTranscript).toHaveBeenNthCalledWith(
      2,
      '7',
      '42',
      3,
      '$g(x)=(x-3)^2-4$。',
    );
    expect(repository.lockPlan).toHaveBeenCalledWith(
      '7',
      '81',
      expect.objectContaining({ transcriptId: '41', transcriptRevision: 2 }),
    );
    expect(repository.freezeAnswer).toHaveBeenCalledWith(
      '7',
      '81',
      expect.objectContaining({ transcriptId: '42', transcriptRevision: 3 }),
    );
  });

  it('does not start an independent assessment before the original answer is correct', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getCurrentAttempt).mockRejectedValue(new NotFoundException());
    vi.mocked(repository.getSourceSession).mockResolvedValue({
      analysis: {
        keyConditions: ['分母含有根式'],
        knowledgePoints: ['分母有理化'],
        overview: '根式化简题',
        target: '使分母不含根号',
      },
      currentAnswerVerdict: 'incorrect',
      preparedCheckTasks: [],
      preparedPacketVersion: null,
      problemMarkdown: '化简 $\\frac{\\sqrt2}{\\sqrt3}$。',
      questionId: null,
    } as Awaited<ReturnType<AssessmentRepository['getSourceSession']>> & {
      currentAnswerVerdict: 'incorrect';
    });

    await expect(service.start('7', '12')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORIGINAL_ANSWER_NOT_READY' }),
    });
    expect(repository.startModelRun).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
  });

  it('independently reviews a bound ready-packet task before generating another task', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getCurrentAttempt).mockRejectedValue(new NotFoundException());
    vi.mocked(repository.getSourceSession).mockResolvedValue({
      analysis: {
        keyConditions: ['二次项系数为正'],
        knowledgePoints: ['配方法', '二次函数最值'],
        overview: '二次函数最值题',
        target: '求最小值',
      },
      currentAnswerVerdict: 'correct',
      preparedCheckTasks: [preparedCheckTask()],
      preparedPacketVersion: 'b'.repeat(64),
      problemMarkdown: '求 $f(x)=x^2-4x$ 的最小值。',
      questionId: 'question-1',
    });
    vi.mocked(repository.isTaskSeen).mockResolvedValue(false);
    vi.mocked(model.generate).mockResolvedValueOnce(
      response({ reason: '条件完整，参考答案与迁移关系可核对', verdict: 'accept' }),
    );
    vi.mocked(repository.createAttempt).mockResolvedValue(attempt({
      promptMarkdown: preparedCheckTask().prompt_md,
    }));

    const result = await service.start('7', '12');

    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(model.generate).mock.calls[0]?.[0].role).toBe('guard');
    expect(repository.startModelRun).toHaveBeenCalledWith(
      '7',
      '12',
      'prepare',
      expect.objectContaining({ operation: 'assessment_start' }),
    );
    expect(repository.recordModelNode).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ runId: 'fixture-run-id' }),
      expect.objectContaining({ nodeKey: 'prepared_task_guard_1', status: 'completed' }),
    );
    expect(repository.completeModelRun).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ runId: 'fixture-run-id' }),
      'completed',
    );
    expect(repository.createAttempt).toHaveBeenCalledWith(
      '7',
      '12',
      expect.objectContaining({
        candidate: expect.objectContaining({
          promptMarkdown: preparedCheckTask().prompt_md,
          rubric: [preparedCheckTask().planning_rubric, preparedCheckTask().execution_rubric],
        }),
        verification: expect.objectContaining({ source: 'prepared_packet' }),
      }),
    );
    expect(result.attempt.promptMarkdown).toContain('x+y=4');
    expect(result.attempt).not.toHaveProperty('referenceAnswerMarkdown');
  });

  it('records conservative estimated usage when the assessment provider reports unknown usage', async () => {
    const { model, repository, service } = setup();
    vi.mocked(repository.getCurrentAttempt).mockRejectedValue(new NotFoundException());
    vi.mocked(repository.getSourceSession).mockResolvedValue({
      analysis: {
        keyConditions: ['二次项系数为正'],
        knowledgePoints: ['配方法'],
        overview: '二次函数最值题',
        target: '求最小值',
      },
      currentAnswerVerdict: 'correct',
      preparedCheckTasks: [preparedCheckTask()],
      preparedPacketVersion: 'b'.repeat(64),
      problemMarkdown: '求 $f(x)=x^2-4x$ 的最小值。',
      questionId: 'question-1',
    });
    vi.mocked(repository.isTaskSeen).mockResolvedValue(false);
    vi.mocked(model.generate).mockResolvedValueOnce({
      ...response({ reason: '迁移关系可核对', verdict: 'accept' }),
      usage: { input: 0, kind: 'unknown', output: 0 },
    });
    vi.mocked(repository.createAttempt).mockResolvedValue(attempt());

    await service.start('7', '12');

    expect(repository.recordModelNode).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ runId: 'fixture-run-id' }),
      expect.objectContaining({
        usage: expect.objectContaining({
          input: expect.any(Number),
          kind: 'estimated',
          output: 800,
        }),
      }),
    );
    const recorded = vi.mocked(repository.recordModelNode).mock.calls[0]?.[2];
    expect(recorded?.usage?.input).toBeGreaterThan(0);
  });

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
    expect(vi.mocked(repository.recordModelNode).mock.calls.map((call) => call[2].nodeKey)).toEqual([
      'task_generation_1',
      'task_guard_1',
    ]);
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
    expect(repository.completeModelRun).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ runId: 'fixture-run-id' }),
      'failed',
    );
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
    expect(repository.startModelRun).toHaveBeenCalledWith(
      '7',
      '12',
      'grade',
      expect.objectContaining({ attemptId: '81', operation: 'assessment_finish' }),
    );
    expect(vi.mocked(repository.recordModelNode).mock.calls.map((call) => call[2].nodeKey)).toEqual([
      'grade',
      'grade_guard',
    ]);
    expect(repository.completeModelRun).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ runId: 'fixture-run-id' }),
      'completed',
    );
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
    expect(repository.recordModelNode).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ runId: 'fixture-run-id' }),
      expect.objectContaining({ nodeKey: 'grade', status: 'failed' }),
    );
    expect(repository.completeModelRun).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ runId: 'fixture-run-id' }),
      'failed',
    );
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
