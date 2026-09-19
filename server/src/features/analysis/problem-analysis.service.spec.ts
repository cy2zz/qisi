import { describe, expect, it, vi } from 'vitest';
import type { ModelPort, ModelRequest, ModelResponse } from '../../model/model.port.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';

const requestId = '11111111-1111-4111-8111-111111111111';

const validAnalysis = {
  firstQuestion: '你准备先求导还是先观察图像？',
  keyConditions: ['函数为三次多项式'],
  knowledgePoints: ['导数', '单调性'],
  overview: '这是一道利用导数研究函数性质的题目。',
  target: '确定单调区间与极值。',
};

const validDiagnosis = {
  evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
  focus_goal_key: 'session-91:method',
  hypotheses: [{
    evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
    explanation: '已经选出方向，但还没有写出导函数及符号判断。',
    id: 'hypothesis-1',
    kind: 'strategy',
    missing_evidence: '需要看到导函数和符号判断。',
    status: 'candidate',
  }],
  judgment: 'unknown',
  probe: null,
  route_review_needed: false,
  route_review_reason: '',
  satisfied_decision_ids: ['session-91:conditions'],
  summary: '方向合理，证据还不足以判断完整路线。',
  task_id: 'session-91',
};

const validStrategy = {
  action: 'ask',
  allowed_disclosures: ['session-91:conditions'],
  allowed_facts: [{
    decision_ids: ['session-91:conditions'],
    source_ref: '题目条件',
    text_md: '函数为三次多项式。',
  }],
  decision_reason: '学生已提出求导，下一步只需补充导函数。',
  expected_student_artifact: '写出导函数并说明下一步怎样判断符号。',
  fading_reason: '当前没有连续自主有效产物，不主动降支架。',
  focus_goal_key: 'session-91:method',
  intervention: 'goal_backchain',
  probe: null,
  reserved_decisions: ['session-91:method', 'session-91:target'],
  route_patch: null,
  scaffold_level: 1,
  task_id: 'session-91',
};

const validRendered = {
  text_md: '求导这个方向有依据。先写出 $f\'(x)$，再说明你准备怎样用它的符号判断单调区间。',
};

const validGuard = {
  actual_disclosed_ids: ['session-91:conditions'],
  disclosure_note: '只确认了已批准的题目条件。',
  issues: [],
  math_note: '表达与题目一致。',
  verdict: 'accept',
  whole_task_disclosed: false,
};

function response(parsed: unknown): ModelResponse {
  return {
    elapsedMs: 12,
    model: 'fixture-model',
    parsed,
    provider: 'fixture',
    providerRequestId: 'fixture-request',
    usage: { input: 20, kind: 'reported', output: 10 },
  };
}

function createRoleModel(overrides: Partial<Record<ModelRequest['role'], unknown>> = {}) {
  const outputs: Partial<Record<ModelRequest['role'], unknown>> = {
    diagnosis: validDiagnosis,
    guard: validGuard,
    renderer: validRendered,
    strategy: validStrategy,
    ...overrides,
  };
  const model: ModelPort = {
    generate: vi.fn((request: ModelRequest) => Promise.resolve(response(outputs[request.role]))),
  };
  return model;
}

function chatInput(overrides: Record<string, unknown> = {}) {
  return {
    analysis: validAnalysis,
    assistanceMode: 'attempt' as const,
    history: [
      { content: '我准备先求导。', role: 'student' as const },
      { content: '把下一步依据写出来。', role: 'guide' as const },
    ],
    message: '我准备先求导。',
    problemMd: '已知函数 $f(x)=x^3-3x$，求单调区间与极值。',
    requestId,
    sessionId: '91',
    teachingState: {
      exposures: [],
      probesShownByGoal: {},
    },
    ...overrides,
  };
}

describe('ProblemAnalysisService', () => {
  it('uses the preparation role and validates the structured analysis', async () => {
    const model = { generate: vi.fn().mockResolvedValue(response(validAnalysis)) };
    const service = new ProblemAnalysisService(model as ModelPort);

    await expect(service.analyze('已知函数 $f(x)=x^3-3x$。')).resolves.toEqual(validAnalysis);
    expect(model.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: '已知函数 $f(x)=x^3-3x$。',
        maxOutputTokens: 1000,
        role: 'preparation',
        system: expect.stringContaining('数学表达式必须使用 Markdown/LaTeX'),
      }),
    );
  });

  it('rejects malformed preparation output instead of projecting it to the student', async () => {
    const model = { generate: vi.fn().mockResolvedValue(response({ overview: 'missing fields' })) };
    const service = new ProblemAnalysisService(model as ModelPort);

    await expect(service.analyze('题目')).rejects.toMatchObject({ status: 502 });
  });

  it('runs Diagnosis, Strategy, Renderer and Guard as separate checked nodes', async () => {
    const model = createRoleModel();
    const service = new ProblemAnalysisService(model);
    const onPhase = vi.fn();
    const onNode = vi.fn().mockResolvedValue(undefined);

    await expect(service.reply(chatInput(), new AbortController().signal, onPhase, onNode))
      .resolves.toMatchObject({
        audit: {
          decisionIds: ['session-91:conditions'],
          focusGoalKey: 'session-91:method',
          intervention: 'goal_backchain',
          probeGoalKey: null,
          scaffoldLevel: 1,
          wholeTaskDisclosed: false,
        },
        reply: validRendered.text_md,
      });

    const calls = vi.mocked(model.generate).mock.calls.map(([request]) => request);
    expect(calls.map((request) => request.role)).toEqual([
      'diagnosis',
      'strategy',
      'renderer',
      'guard',
    ]);
    expect(onPhase.mock.calls.flat()).toEqual(['diagnosing', 'planning', 'rendering', 'guarding']);
    expect(onNode).toHaveBeenCalledTimes(4);
    expect(onNode.mock.calls.map(([node]) => node.nodeKey)).toEqual([
      'diagnosis',
      'strategy',
      'renderer',
      'guard',
    ]);

    const rendererInput = calls[2]?.input as Record<string, unknown>;
    expect(rendererInput).not.toHaveProperty('diagnosis');
    expect(rendererInput).not.toHaveProperty('private_reference_md');
    expect(rendererInput).not.toHaveProperty('reserved_decisions');
    expect(rendererInput).toMatchObject({
      action: 'ask',
      approved_facts: validStrategy.allowed_facts,
      scaffold_level: 1,
    });
  });

  it('does not expose a Guard-accepted message that exceeds Strategy disclosure', async () => {
    const model = createRoleModel({
      guard: {
        ...validGuard,
        actual_disclosed_ids: ['session-91:target'],
        verdict: 'accept',
      },
    });
    const service = new ProblemAnalysisService(model);

    await expect(service.reply(chatInput({ assistanceMode: 'hint' }))).resolves.toEqual({
      reply: '这条提示可能泄露关键结论，暂不展示。先回到题目的已知条件，圈出与当前目标直接相关的一项。',
    });
  });

  it('passes persisted exposures to Strategy and enforces the two-probe budget for the same goal', async () => {
    const probe = {
      branches: [
        {
          counter_evidence: '能正确说明导数的作用',
          expected: '只会写求导但不会判断符号',
          hypothesis_id: 'hypothesis-1',
          next_action: '改用符号表桥接',
        },
        {
          counter_evidence: '符号表仍无法建立',
          expected: '能独立写出符号表',
          hypothesis_id: 'hypothesis-2',
          next_action: '定位零点计算',
        },
      ],
      goal_key: 'session-91:method',
      question_md: '导函数的符号怎样决定原函数的单调性？',
    };
    const model = createRoleModel({ strategy: { ...validStrategy, probe } });
    const service = new ProblemAnalysisService(model);
    const exposure = {
      content_hash: 'a'.repeat(64),
      created_at: '2026-09-19T12:00:00.000Z',
      decision_ids: ['session-91:conditions'],
      id: 'exposure-1',
      reason: 'teacher_hint' as const,
      scope: 'listed_decisions' as const,
      task_id: 'session-91',
      turn_id: 'turn-1',
    };

    await expect(service.reply(chatInput({
      assistanceMode: 'hint',
      teachingState: {
        exposures: [exposure],
        probesShownByGoal: { 'session-91:method': 2 },
      },
    }))).resolves.toEqual({
      reply: '这条提示可能泄露关键结论，暂不展示。先回到题目的已知条件，圈出与当前目标直接相关的一项。',
    });

    const strategyRequest = vi.mocked(model.generate).mock.calls
      .map(([request]) => request)
      .find((request) => request.role === 'strategy');
    expect(strategyRequest?.input).toMatchObject({
      exposures: [exposure],
      remaining_probes: 0,
    });
  });

  it('reviews a valid alternative student route before Strategy uses it', async () => {
    const reviewedDecision = {
      acceptance_rule: '能说明配方法与求导法得到同一最值结论。',
      common_gaps: ['漏写平方项非负'],
      entry_condition: '学生提出配方法路线。',
      expected_artifact: '写成完全平方并指出最小值条件。',
      goal: '用配方法建立合法异解',
      goal_key: 'session-91:student-route:complete-square',
      id: 'session-91:student-route:complete-square',
      parent_goal_key: 'session-91:method',
      part_id: 'session-91',
      prerequisite_ids: ['session-91:conditions'],
      source: 'student' as const,
    };
    const routePatch = {
      blocking_issues: [],
      evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
      math_status: 'valid' as const,
      new_decisions: [reviewedDecision],
      new_routes: [{
        decision_ids: ['session-91:conditions', reviewedDecision.id],
        evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
        id: 'session-91:student-route',
        math_status: 'valid' as const,
        note: '学生提出的合法异解。',
        source: 'student' as const,
        terminal_ids: [reviewedDecision.id],
      }],
      task_id: 'session-91',
      verification: [{
        checked_at: '2026-09-19T12:00:00.000Z',
        kind: 'model_checked' as const,
        reference: '当前题干与学生已确认输入',
        reviewer_or_model: 'fixture-model',
        status: 'pass' as const,
        summary: '路线在题目条件下成立。',
      }],
    };
    let guardCall = 0;
    const model: ModelPort = {
      generate: vi.fn((request: ModelRequest) => {
        if (request.role === 'diagnosis') {
          return Promise.resolve(response({
            ...validDiagnosis,
            route_review_needed: true,
            route_review_reason: '学生提出了不同于教师初始路线的合法候选。',
          }));
        }
        if (request.role === 'preparation') return Promise.resolve(response(routePatch));
        if (request.role === 'strategy') return Promise.resolve(response({
          ...validStrategy,
          route_patch: routePatch,
        }));
        if (request.role === 'renderer') return Promise.resolve(response(validRendered));
        guardCall += 1;
        return Promise.resolve(response(guardCall === 1
          ? { ...validGuard, actual_disclosed_ids: [] }
          : validGuard));
      }),
    };
    const service = new ProblemAnalysisService(model);

    await expect(service.reply(chatInput())).resolves.toMatchObject({ reply: validRendered.text_md });

    const calls = vi.mocked(model.generate).mock.calls.map(([request]) => request);
    expect(calls.map((request) => request.role)).toEqual([
      'diagnosis',
      'preparation',
      'guard',
      'strategy',
      'renderer',
      'guard',
    ]);
    expect(calls[3]?.input).toMatchObject({
      decisions: expect.arrayContaining([expect.objectContaining({ id: reviewedDecision.id })]),
      route_patch: routePatch,
    });
  });

  it('keeps an unverified alternative route out of Strategy even when its Guard says accept', async () => {
    const unverifiedPatch = {
      blocking_issues: ['缺少关键等号成立条件'],
      evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
      math_status: 'unknown' as const,
      new_decisions: [],
      new_routes: [],
      task_id: 'session-91',
      verification: [{
        checked_at: '2026-09-19T12:00:00.000Z',
        kind: 'model_checked' as const,
        reference: '当前题干',
        reviewer_or_model: 'fixture-model',
        status: 'unknown' as const,
        summary: '无法确认路线成立。',
      }],
    };
    let guardCall = 0;
    const model: ModelPort = {
      generate: vi.fn((request: ModelRequest) => {
        if (request.role === 'diagnosis') {
          return Promise.resolve(response({
            ...validDiagnosis,
            route_review_needed: true,
            route_review_reason: '候选异解需要核对。',
          }));
        }
        if (request.role === 'preparation') return Promise.resolve(response(unverifiedPatch));
        if (request.role === 'strategy') return Promise.resolve(response(validStrategy));
        if (request.role === 'renderer') return Promise.resolve(response(validRendered));
        guardCall += 1;
        return Promise.resolve(response(guardCall === 1
          ? { ...validGuard, actual_disclosed_ids: [] }
          : validGuard));
      }),
    };
    const service = new ProblemAnalysisService(model);

    await expect(service.reply(chatInput())).resolves.toMatchObject({ reply: validRendered.text_md });

    const strategyRequest = vi.mocked(model.generate).mock.calls
      .map(([request]) => request)
      .find((request) => request.role === 'strategy');
    expect(strategyRequest?.input).toMatchObject({ route_patch: null });
    expect((strategyRequest?.input as { decisions: Array<{ id: string }> }).decisions)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ source: 'student' })]));
  });

  it('rejects a Strategy that exceeds the requested help depth before rendering', async () => {
    const model = createRoleModel({
      strategy: { ...validStrategy, action: 'worked_solution', scaffold_level: 4 },
    });
    const service = new ProblemAnalysisService(model);

    await expect(service.reply(chatInput({ assistanceMode: 'hint' }))).resolves.toEqual({
      reply: '这条提示可能泄露关键结论，暂不展示。先回到题目的已知条件，圈出与当前目标直接相关的一项。',
    });
    expect(vi.mocked(model.generate).mock.calls.map(([request]) => request.role))
      .toEqual(['diagnosis', 'strategy']);
  });

  it('maps a valid finished answer to a current-problem verdict without claiming mastery', async () => {
    const model = createRoleModel({
      diagnosis: { ...validDiagnosis, judgment: 'valid' },
      renderer: {
        text_md: '当前结论有依据。这只核对本题作答，掌握情况仍需之后用新题检验。',
      },
      strategy: {
        ...validStrategy,
        action: 'complete',
        allowed_disclosures: ['session-91:target'],
        reserved_decisions: [],
        scaffold_level: 0,
      },
      guard: { ...validGuard, actual_disclosed_ids: ['session-91:target'] },
    });
    const service = new ProblemAnalysisService(model);

    await expect(service.reply(chatInput({ assistanceMode: 'finish_problem' }))).resolves.toMatchObject({
      audit: {
        decisionIds: ['session-91:target'],
        focusGoalKey: 'session-91:method',
        probeGoalKey: null,
      },
      currentVerdict: 'correct',
      reply: '当前结论有依据。这只核对本题作答，掌握情况仍需之后用新题检验。',
    });
  });

  it('treats malformed Guard output as rejection and records the failed node', async () => {
    const model = createRoleModel({ guard: { verdict: 'unknown' } });
    const service = new ProblemAnalysisService(model);
    const onNode = vi.fn().mockResolvedValue(undefined);

    await expect(
      service.reply(chatInput({ assistanceMode: 'hint' }), undefined, undefined, onNode),
    ).resolves.toEqual({
      reply: '这条提示可能泄露关键结论，暂不展示。先回到题目的已知条件，圈出与当前目标直接相关的一项。',
    });
    expect(onNode).toHaveBeenLastCalledWith(expect.objectContaining({
      nodeKey: 'guard',
      output: null,
      status: 'failed',
    }));
  });
});
