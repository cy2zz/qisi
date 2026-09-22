import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { PreparationService } from '../preparation/preparation.service.js';
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
    expect(calls[1]?.input).toMatchObject({
      user_action: expect.stringContaining('allowed_facts.source_ref 仅可使用'),
    });
  });

  it('requests interactive model settings for every teaching role and audits the applied settings', async () => {
    const fixture = createRoleModel();
    const model: ModelPort = { generate: vi.fn(async (request) => Object.assign(await fixture.generate(request), { reasoningEffort: 'none', outputVerbosity: 'low', latencyProfileVersion: 'interactive-v1' })) };
    const onNode = vi.fn().mockResolvedValue(undefined);
    await new ProblemAnalysisService(model).reply(chatInput(), new AbortController().signal, undefined, onNode);
    expect(model.generate).toHaveBeenCalledTimes(4);
    for (const [request] of vi.mocked(model.generate).mock.calls) expect(request).toMatchObject({ latencyProfile: 'interactive' });
    for (const [node] of onNode.mock.calls) expect(node.usage).toMatchObject({ reasoningEffort: 'none', outputVerbosity: 'low', latencyProfileVersion: 'interactive-v1' });
  });

  it('tells Strategy the same L1 ceiling that the attempt policy gate enforces', async () => {
    const model = createRoleModel();
    await new ProblemAnalysisService(model).reply(chatInput());
    const input = vi.mocked(model.generate).mock.calls.find(([request]) => request.role === 'strategy')![0].input as { user_action: string };
    expect(input.user_action).toContain('最多 L1');
    expect(input.user_action).toContain('scaffold_level');
    expect(input.user_action).toContain('禁止 worked_solution');
  });

  it.each([
    ['method', '方法修正', '只核对学生的选法和依据'],
    ['execution', '执行修正', '只定位第一处需要修正的计算、变形或表达'],
    ['evidence', '证据边界', '只解释本次为何不能记为独立通过'],
  ] as const)(
    'keeps an independent-check %s return inside its remediation boundary',
    async (remediationFocus, label, boundary) => {
    const model = createRoleModel();
    const service = new ProblemAnalysisService(model);

    await service.reply(chatInput({
      message: '我准备先求导。我的方法是对的，但执行中有一步需要修正。我卡在：展开后符号不确定。',
      remediationFocus,
    }));

    const strategyRequest = vi.mocked(model.generate).mock.calls
      .map(([request]) => request)
      .find((request) => request.role === 'strategy');
    expect(strategyRequest?.input).toMatchObject({
      user_action: expect.stringContaining(label),
    });
    expect((strategyRequest?.input as { user_action: string }).user_action).toContain(boundary);
    const guardRequest = vi.mocked(model.generate).mock.calls
      .map(([request]) => request)
      .find((request) => request.role === 'guard');
    expect(guardRequest?.input).toMatchObject({
      reference_md: expect.stringContaining(boundary),
    });
  });

  it('uses the exact ready preparation packet bound to the learning session', async () => {
    const decision = {
      acceptance_rule: '写出定义域与取等条件。',
      common_gaps: ['漏写定义域', '漏写取等条件'],
      entry_condition: '已经读懂题目。',
      expected_artifact: '说明 $x>0$ 且 $x=1$ 时取等。',
      goal: '核对基本不等式的使用条件',
      goal_key: 'official:am-gm-condition',
      id: 'official:d1',
      parent_goal_key: null,
      part_id: 'question-803',
      prerequisite_ids: [],
      source: 'teacher' as const,
    };
    const route = {
      decision_ids: [decision.id],
      evidence_refs: [],
      id: 'official:route-1',
      math_status: 'valid' as const,
      note: '原卷解析路线。',
      source: 'teacher' as const,
      terminal_ids: [decision.id],
    };
    const diagnosis = {
      ...validDiagnosis,
      focus_goal_key: decision.goal_key,
      hypotheses: [{
        ...validDiagnosis.hypotheses[0],
        explanation: '学生选择了方法，但还没有写取等条件。',
      }],
      satisfied_decision_ids: [],
    };
    const strategy = {
      ...validStrategy,
      allowed_disclosures: [decision.id],
      allowed_facts: [{
        decision_ids: [decision.id],
        source_ref: 'private_reference_md',
        text_md: '$x>0$ 是使用基本不等式的必要条件。',
      }],
      focus_goal_key: decision.goal_key,
      reserved_decisions: [],
    };
    const guard = {
      ...validGuard,
      actual_disclosed_ids: [decision.id],
    };
    const model = createRoleModel({ diagnosis, guard, strategy });
    const preparation = {
      findReadyPacket: vi.fn().mockResolvedValue({
        decisions: [decision],
        problem_hash: createHash('sha256')
          .update('已知函数 $f(x)=x^3-3x$，求单调区间与极值。')
          .digest('hex'),
        ready: true,
        reference_md: '原卷解析：先核对定义域，再使用基本不等式并检查取等条件。',
        routes: [route],
        version: 'a'.repeat(64),
      }),
    };
    const service = new ProblemAnalysisService(model, preparation as never);

    await expect(service.reply(chatInput({ packetVersion: 'a'.repeat(64) })))
      .resolves.toMatchObject({ reply: validRendered.text_md });

    const calls = vi.mocked(model.generate).mock.calls.map(([request]) => request);
    expect(preparation.findReadyPacket).toHaveBeenCalledWith(
      createHash('sha256')
        .update('已知函数 $f(x)=x^3-3x$，求单调区间与极值。')
        .digest('hex'),
      'a'.repeat(64),
    );
    expect(calls[0]?.input).toMatchObject({
      decisions: [decision],
      private_reference_md: expect.stringContaining('原卷解析'),
      routes: [route],
    });
    expect(calls[1]?.input).toMatchObject({
      decisions: [decision],
      private_reference_md: expect.stringContaining('原卷解析'),
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

  it('rejects a diagnosis that cites a nonexistent submission before persisting it as a completed node', async () => {
    const model = createRoleModel({
      diagnosis: {
        ...validDiagnosis,
        evidence_refs: [{
          quote: '我从未说过这句话',
          revision: 1,
          submission_id: 'missing-submission',
        }],
      },
    });
    const service = new ProblemAnalysisService(model);
    const onNode = vi.fn().mockResolvedValue(undefined);

    await expect(service.reply(chatInput(), undefined, undefined, onNode))
      .rejects.toThrow('diagnosis cited invalid evidence');
    expect(onNode).toHaveBeenCalledOnce();
    expect(onNode).toHaveBeenCalledWith(expect.objectContaining({
      nodeKey: 'diagnosis',
      output: null,
      status: 'failed',
    }));
    expect(vi.mocked(model.generate).mock.calls.map(([request]) => request.role))
      .toEqual(['diagnosis']);
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

    await expect(service.reply(chatInput())).resolves.toMatchObject({
      reply: validRendered.text_md,
      routeAttribution: 'student',
    });

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

  it('keeps a previously approved student route in the next turn context', async () => {
    const restoredDecision = {
      acceptance_rule: '均值不等式与取等条件正确。',
      common_gaps: ['尚未讨论单调性'],
      entry_condition: '学生已给出均值不等式路线。',
      expected_artifact: '保留最值结论并继续讨论单调性。',
      goal: '沿学生路线保留最值结论',
      goal_key: 'session-91:student-route:am-gm',
      id: 'session-91:student-route:am-gm',
      parent_goal_key: 'session-91:target',
      part_id: 'session-91',
      prerequisite_ids: ['session-91:conditions'],
      source: 'student' as const,
    };
    const restoredPatch = {
      blocking_issues: [],
      evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
      math_status: 'valid' as const,
      new_decisions: [restoredDecision],
      new_routes: [{
        decision_ids: ['session-91:conditions', restoredDecision.id],
        evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
        id: 'session-91:student-am-gm-route',
        math_status: 'valid' as const,
        note: '上一轮已核对的学生路线。',
        source: 'student' as const,
        terminal_ids: [restoredDecision.id],
      }],
      task_id: 'session-91',
      verification: [{
        checked_at: '2026-09-20T00:00:00.000Z',
        kind: 'model_checked' as const,
        reference: '上一轮已确认输入',
        reviewer_or_model: 'fixture-model',
        status: 'pass' as const,
        summary: '均值不等式路线成立。',
      }],
    };
    const model = createRoleModel({
      strategy: { ...validStrategy, route_patch: restoredPatch },
    });
    const service = new ProblemAnalysisService(model);

    await expect(service.reply(chatInput({
      teachingState: {
        exposures: [],
        probesShownByGoal: {},
        routePatches: [restoredPatch],
      },
    }))).resolves.toEqual({
      audit: expect.any(Object),
      reply: validRendered.text_md,
    });

    const calls = vi.mocked(model.generate).mock.calls.map(([request]) => request);
    expect(calls.map((request) => request.role)).toEqual([
      'diagnosis',
      'strategy',
      'renderer',
      'guard',
    ]);
    expect(calls[1]?.input).toMatchObject({
      decisions: expect.arrayContaining([expect.objectContaining({ id: restoredDecision.id })]),
      route_patch: restoredPatch,
    });
  });

  it('keeps a valid student subroute when the full answer still has an unfinished goal', async () => {
    const reviewedDecision = {
      acceptance_rule: '均值不等式条件与取等条件正确。',
      common_gaps: ['尚未讨论单调性'],
      entry_condition: '学生提出均值不等式路线。',
      expected_artifact: '得到最小值并说明取等条件。',
      goal: '用均值不等式求最小值',
      goal_key: 'session-91:student-route:am-gm',
      id: 'session-91:student-route:am-gm',
      parent_goal_key: 'session-91:target',
      part_id: 'session-91',
      prerequisite_ids: ['session-91:conditions'],
      source: 'student' as const,
    };
    const partialRoutePatch = {
      blocking_issues: [],
      evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
      // The student's local route is mathematically valid, while the full
      // answer remains incomplete because another requested goal is missing.
      math_status: 'invalid' as const,
      new_decisions: [reviewedDecision],
      new_routes: [{
        decision_ids: [reviewedDecision.id],
        evidence_refs: [{ quote: '我准备先求导。', revision: 1, submission_id: requestId }],
        id: 'session-91:student-am-gm-subroute',
        math_status: 'valid' as const,
        note: '学生路线正确完成最值，单调性仍需另行补充。',
        source: 'student' as const,
        terminal_ids: [reviewedDecision.id],
      }],
      task_id: 'session-91',
      verification: [{
        checked_at: '2026-09-20T00:00:00.000Z',
        kind: 'model_checked' as const,
        reference: '当前题干与学生已确认输入',
        reviewer_or_model: 'fixture-model',
        status: 'pass' as const,
        summary: '学生子路线数学成立；完整作答仍缺单调性。',
      }],
    };
    let guardCall = 0;
    const model: ModelPort = {
      generate: vi.fn((request: ModelRequest) => {
        if (request.role === 'diagnosis') {
          return Promise.resolve(response({
            ...validDiagnosis,
            route_review_needed: true,
            route_review_reason: '学生提出了局部有效、但未覆盖全部题目目标的异解。',
          }));
        }
        if (request.role === 'preparation') return Promise.resolve(response(partialRoutePatch));
        if (request.role === 'strategy') return Promise.resolve(response({
          ...validStrategy,
          route_patch: partialRoutePatch,
        }));
        if (request.role === 'renderer') return Promise.resolve(response(validRendered));
        guardCall += 1;
        return Promise.resolve(response(guardCall === 1
          ? { ...validGuard, actual_disclosed_ids: [] }
          : validGuard));
      }),
    };
    const service = new ProblemAnalysisService(model);

    await expect(service.reply(chatInput())).resolves.toMatchObject({
      reply: validRendered.text_md,
      routeAttribution: 'student',
    });

    const strategyRequest = vi.mocked(model.generate).mock.calls
      .map(([request]) => request)
      .find((request) => request.role === 'strategy');
    expect(strategyRequest?.input).toMatchObject({
      decisions: expect.arrayContaining([expect.objectContaining({ id: reviewedDecision.id })]),
      route_patch: partialRoutePatch,
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

  it('rejects an approved fact whose claimed source is not in the trusted Strategy context', async () => {
    const model = createRoleModel({
      strategy: {
        ...validStrategy,
        allowed_facts: [{
          decision_ids: ['session-91:method'],
          source_ref: 'deterministic_derivative_from_private_reference',
          text_md: "$f'(x)=3x^2-3$。",
        }],
      },
    });
    const service = new ProblemAnalysisService(model);
    const onNode = vi.fn().mockResolvedValue(undefined);

    await expect(service.reply(chatInput({ assistanceMode: 'explain' }), undefined, undefined, onNode))
      .resolves.toEqual({
        reply: '这段解释暂时无法安全核对。请指出你卡住的是条件理解、公式选择还是计算。',
      });
    expect(vi.mocked(model.generate).mock.calls.map(([request]) => request.role))
      .toEqual(['diagnosis', 'strategy']);
    expect(onNode).toHaveBeenLastCalledWith(expect.objectContaining({
      nodeKey: 'strategy',
      output: null,
      status: 'failed',
    }));
  });

  it('tells Strategy the finish action contract without treating a completed check as a correct answer', async () => {
    const model = createRoleModel();
    await new ProblemAnalysisService(model).reply(chatInput({ assistanceMode: 'finish_problem' }));
    const input = vi.mocked(model.generate).mock.calls.find(([request]) => request.role === 'strategy')![0].input as { user_action: string };
    expect(input.user_action).toContain('action 只能为 complete 或 uncertain');
    expect(input.user_action).toContain('并不表示答案正确');
    expect(input.user_action).toContain('有依据的错误必须明确指出');
  });

  it.each([
    ['invalid', 'complete', 'incorrect'],
    ['unknown', 'uncertain', 'unknown'],
  ] as const)('keeps the %s diagnosis verdict when finishing the current check', async (judgment, action, verdict) => {
    const model = createRoleModel({
      diagnosis: { ...validDiagnosis, judgment },
      strategy: { ...validStrategy, action },
    });
    const result = await new ProblemAnalysisService(model).reply(chatInput({ assistanceMode: 'finish_problem' }));
    expect(result.currentVerdict).toBe(verdict);
    expect(result.audit).toBeDefined();
    expect(vi.mocked(model.generate).mock.calls.map(([request]) => request.role))
      .toEqual(['diagnosis', 'strategy', 'renderer', 'guard']);
  });

  it('still rejects a teaching action outside the finish contract before rendering', async () => {
    const model = createRoleModel({ strategy: { ...validStrategy, action: 'ask' } });
    const result = await new ProblemAnalysisService(model).reply(chatInput({ assistanceMode: 'finish_problem' }));
    expect(result.currentVerdict).toBe('unknown');
    expect(result.audit).toBeUndefined();
    expect(vi.mocked(model.generate).mock.calls.map(([request]) => request.role)).toEqual(['diagnosis', 'strategy']);
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


describe('ProblemAnalysisService turn time budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T06:25:23.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('cancels a stalled node at 25 seconds and discards non-cooperative late output', async () => {
    const model = createRoleModel();
    let finish!: (value: ModelResponse) => void;
    vi.mocked(model.generate).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const onNode = vi.fn().mockResolvedValue(undefined);
    const pending = new ProblemAnalysisService(model).reply(chatInput(), new AbortController().signal, undefined, onNode);
    const result = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toMatchObject({ name: 'TurnTimeoutError', code: 'MODEL_NODE_TIMEOUT' });
    expect(vi.mocked(model.generate).mock.calls[0]![0].signal.aborted).toBe(true);
    expect(onNode).toHaveBeenCalledWith(expect.objectContaining({ nodeKey: 'diagnosis', status: 'failed' }));
    finish(response(validDiagnosis));
    await vi.advanceTimersByTimeAsync(0);
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(onNode).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the reserved absolute deadline across four individually valid 24-second calls', async () => {
    const model = createRoleModel();
    const immediate = model.generate;
    const delayed: ModelPort = { generate: vi.fn(async (request) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 24_000));
      return immediate(request);
    }) };
    const onNode = vi.fn().mockResolvedValue(undefined);
    const input = chatInput({ deadlineAt: new Date(Date.now() + 90_000).toISOString() });
    const result = new ProblemAnalysisService(delayed).reply(input, new AbortController().signal, undefined, onNode)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(await result).toMatchObject({ code: 'TURN_DEADLINE_EXCEEDED' });
    expect(vi.mocked(delayed.generate).mock.calls.map(([request]) => request.role))
      .toEqual(['diagnosis', 'strategy', 'renderer', 'guard']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onNode.mock.calls.filter(([record]) => record.status === 'completed')).toHaveLength(3);
    expect(onNode).toHaveBeenCalledWith(expect.objectContaining({ nodeKey: 'guard', status: 'failed' }));
  });

  it.each(['2026-09-22T06:25:22.000Z', 'not-a-date'])('rejects unusable server deadline %s before model I/O', async (deadlineAt) => {
    const model = createRoleModel();
    await expect(new ProblemAnalysisService(model).reply(chatInput({ deadlineAt })))
      .rejects.toMatchObject({ code: 'TURN_DEADLINE_EXCEEDED' });
    expect(model.generate).not.toHaveBeenCalled();
  });

  it('shortens the first node to the remaining reserved time, keeping a finalization margin', async () => {
    const model = { generate: vi.fn(() => new Promise<ModelResponse>(() => undefined)) };
    const result = new ProblemAnalysisService(model).reply(chatInput({
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    })).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(await result).toMatchObject({ code: 'TURN_DEADLINE_EXCEEDED' });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interrupts a non-cooperative provider when the client cancels', async () => {
    const model = { generate: vi.fn(() => new Promise<ModelResponse>(() => undefined)) };
    const abort = new AbortController();
    const result = new ProblemAnalysisService(model).reply(chatInput(), abort.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the original timeout when failure-audit persistence also rejects', async () => {
    const model = { generate: vi.fn(() => new Promise<ModelResponse>(() => undefined)) };
    const onNode = vi.fn().mockRejectedValue(new Error('fixture audit rejected'));
    const result = new ProblemAnalysisService(model).reply(chatInput(), new AbortController().signal, undefined, onNode)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toMatchObject({ code: 'MODEL_NODE_TIMEOUT' });
    expect(onNode).toHaveBeenCalledOnce();
  });

  it('rejects a node that crosses its wall-clock limit before its timer callback runs', async () => {
    const model = createRoleModel();
    vi.mocked(model.generate).mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 26_000);
      return response(validDiagnosis);
    });
    await expect(new ProblemAnalysisService(model).reply(chatInput()))
      .rejects.toMatchObject({ code: 'MODEL_NODE_TIMEOUT' });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('also bounds preparation lookup and never starts models after its late result', async () => {
    const model = createRoleModel();
    let finish!: (value: null) => void;
    const preparation = { findReadyPacket: vi.fn(() => new Promise<null>((resolve) => { finish = resolve; })) };
    const service = new ProblemAnalysisService(model, preparation as unknown as PreparationService);
    const result = service.reply(chatInput({ packetVersion: 'fixture-v1', deadlineAt: new Date(Date.now() + 5_000).toISOString() }))
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await result).toMatchObject({ code: 'TURN_DEADLINE_EXCEEDED' });
    finish(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(model.generate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up timeouts when all four roles finish successfully', async () => {
    const model = createRoleModel();
    await expect(new ProblemAnalysisService(model).reply(chatInput())).resolves.toMatchObject({ reply: validRendered.text_md });
    expect(vi.getTimerCount()).toBe(0);
  });
});
