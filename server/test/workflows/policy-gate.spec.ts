// PolicyGate 测试：证明"未批准就不能写/展示"的边界由代码独立成立，
// 不因 Guard（模型）返回 accept 而被绕过。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssessmentOutputSchema, GuardResultSchema, PacketSchema, StrategySchema, type GuardResult, type Strategy } from '../../src/contracts/domain.schema.js';
import { gateGrading, gatePreparation, gateTurn } from '../../src/workflows/policy-gate.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');

function readFixture<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(fixturesDirectory, fileName), 'utf8')) as T;
}

const strategyFixture = StrategySchema.parse(readFixture('strategy.json'));
const packetFixture = PacketSchema.parse(readFixture('packet.json'));
const guardFixture = GuardResultSchema.parse(readFixture('guard.json'));
const assessmentFixture = AssessmentOutputSchema.parse(readFixture('assessment-output.json'));

const knownDecisionIds = new Set(packetFixture.decisions.map((decision) => decision.id));

/** 构造一个带探针的策略副本，用于验证探针上限。 */
function withProbe(strategy: Strategy): Strategy {
  return {
    ...strategy,
    focus_goal_key: packetFixture.decisions[0]?.goal_key ?? strategy.focus_goal_key,
    probe: {
      goal_key: packetFixture.decisions[0]?.goal_key ?? strategy.focus_goal_key,
      question_md: '你怎样说明这一项的求导依据？',
      branches: [
        { hypothesis_id: 'h1', expected: '规则记反', counter_evidence: '能说清幂函数求导', next_action: '概念桥梁' },
        { hypothesis_id: 'h2', expected: '抄写失误', counter_evidence: '重复同样错误', next_action: '邀请自查' },
      ],
    },
  };
}

function turnInput(overrides: Partial<Parameters<typeof gateTurn>[0]> = {}) {
  return {
    strategy: strategyFixture,
    guard: guardFixture,
    knownDecisionIds,
    probesShownForFocusGoal: 0,
    ...overrides,
  };
}

describe('gateTurn：披露边界', () => {
  it('合规策略在 Guard accept 时放行', () => {
    const decision = gateTurn(turnInput());
    expect(decision.approved).toBe(true);
  });

  it('允许披露与保留决策相交时否决——即使 Guard 已 accept', () => {
    const overlapping = StrategySchema.parse({
      ...strategyFixture,
      allowed_disclosures: [packetFixture.decisions[0]?.id],
      reserved_decisions: [packetFixture.decisions[0]?.id],
    });
    const decision = gateTurn(turnInput({ strategy: overlapping }));
    expect(decision.approved).toBe(false);
    expect(decision).toMatchObject({ code: 'DISCLOSURE_RESERVED_OVERLAP' });
  });

  it('引用不属于当前 task 的决策时否决', () => {
    const unknown = StrategySchema.parse({ ...strategyFixture, allowed_disclosures: ['ghost'], reserved_decisions: [] });
    const decision = gateTurn(turnInput({ strategy: unknown }));
    expect(decision).toMatchObject({ approved: false, code: 'DISCLOSURE_UNKNOWN_DECISION' });
  });

  it('Guard 识别出未获 Strategy 批准的实际披露时否决', () => {
    const actuallyDisclosed: GuardResult = {
      ...guardFixture,
      actual_disclosed_ids: [packetFixture.decisions[1]!.id],
      verdict: 'accept',
    };
    const strategy = StrategySchema.parse({
      ...strategyFixture,
      allowed_disclosures: [packetFixture.decisions[0]!.id],
      reserved_decisions: packetFixture.decisions.slice(1).map((decision) => decision.id),
    });

    expect(gateTurn(turnInput({ guard: actuallyDisclosed, strategy }))).toMatchObject({
      approved: false,
      code: 'DISCLOSURE_NOT_ALLOWED',
    });
  });
});

describe('gateTurn：两探针上限', () => {
  it('探针未达上限时放行', () => {
    expect(gateTurn(turnInput({ strategy: withProbe(strategyFixture), probesShownForFocusGoal: 1 })).approved).toBe(true);
  });

  it('同一 canonical goal 已显示两次后不得再提探针', () => {
    const decision = gateTurn(turnInput({ strategy: withProbe(strategyFixture), probesShownForFocusGoal: 2 }));
    expect(decision).toMatchObject({ approved: false, code: 'PROBE_LIMIT_REACHED' });
  });

  it('已达上限但策略不再提探针时仍可放行（转为局部解释/待定）', () => {
    const decision = gateTurn(turnInput({ strategy: { ...strategyFixture, probe: null }, probesShownForFocusGoal: 2 }));
    expect(decision.approved).toBe(true);
  });
});

describe('gateTurn：Guard 只是输入之一', () => {
  it('Guard 非 accept 时否决', () => {
    const revise: GuardResult = { ...guardFixture, verdict: 'revise' };
    expect(gateTurn(turnInput({ guard: revise }))).toMatchObject({ approved: false, code: 'GUARD_NOT_ACCEPTED' });
  });

  it('Guard unknown 同样否决——数学不确定不得放行', () => {
    const unknown: GuardResult = { ...guardFixture, verdict: 'unknown' };
    expect(gateTurn(turnInput({ guard: unknown }))).toMatchObject({ approved: false, code: 'GUARD_NOT_ACCEPTED' });
  });
});

describe('gateTurn：整题曝光记账', () => {
  it('worked_solution 放行但记整题曝光，不伪装成低支架', () => {
    const worked = StrategySchema.parse({ ...strategyFixture, action: 'worked_solution', scaffold_level: 4 });
    const decision = gateTurn(turnInput({ strategy: worked }));
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.wholeTaskDisclosed).toBe(true);
    }
  });

  it('Guard 声明整题泄露时同样记账', () => {
    const disclosed: GuardResult = { ...guardFixture, whole_task_disclosed: true };
    const decision = gateTurn(turnInput({ guard: disclosed }));
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.wholeTaskDisclosed).toBe(true);
    }
  });

  it('L0 低支架且 Guard 未声明时不算整题曝光', () => {
    const low = StrategySchema.parse({ ...strategyFixture, action: 'ask', scaffold_level: 0 });
    const decision = gateTurn(turnInput({ strategy: low }));
    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.wholeTaskDisclosed).toBe(false);
    }
  });
});

describe('gatePreparation', () => {
  it('ready 且无阻塞项时放行', () => {
    expect(gatePreparation(packetFixture).approved).toBe(true);
  });

  it('ready 为假时否决——保持原题待核对，不换题', () => {
    expect(gatePreparation({ ...packetFixture, ready: false })).toMatchObject({ approved: false, code: 'PACKET_NOT_READY' });
  });

  it('存在 blocking_issues 时否决', () => {
    expect(gatePreparation({ ...packetFixture, blocking_issues: ['数学矛盾'] })).toMatchObject({
      approved: false,
      code: 'PACKET_NOT_READY',
    });
  });

  it('reference_source 为空时否决', () => {
    expect(gatePreparation({ ...packetFixture, reference_source: '   ' })).toMatchObject({
      approved: false,
      code: 'PACKET_NOT_READY',
    });
  });
});

describe('gateGrading：模型不得授予独立资格', () => {
  it('合规评分输出放行', () => {
    expect(gateGrading(assessmentFixture).approved).toBe(true);
  });

  it('输出夹带独立资格字段时否决', () => {
    const tampered = { ...assessmentFixture, independent_pass: true } as typeof assessmentFixture;
    expect(gateGrading(tampered)).toMatchObject({ approved: false, code: 'MODEL_GRANTED_INDEPENDENCE' });
  });

  it('输出夹带 help_exposed 时否决', () => {
    const tampered = { ...assessmentFixture, help_exposed: false } as typeof assessmentFixture;
    expect(gateGrading(tampered)).toMatchObject({ approved: false, code: 'MODEL_GRANTED_INDEPENDENCE' });
  });
});
