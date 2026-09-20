// 路线图：AND/OR 结构、补丁合并与问题判定。
// 对应 B02 步骤 1「主路线与可选异解的AND/OR图」。

import { describe, expect, it } from 'vitest';
import { DecisionSchema, RouteSchema, RoutePatchSchema, type Decision, type Route } from '../../src/contracts/domain.schema.js';
import { applyRoutePatch, findCycles, problemContentHash, validateRouteGraph, type RouteGraph } from '../../src/agents/preparation/route-graph.js';

function decision(id: string, prerequisites: readonly string[] = []): Decision {
  return DecisionSchema.parse({
    id,
    goal_key: `self-001:${id}`,
    goal: `目标 ${id}`,
    part_id: 'p1',
    parent_goal_key: null,
    source: 'teacher',
    prerequisite_ids: [...prerequisites],
    entry_condition: '',
    expected_artifact: '',
    acceptance_rule: '',
    common_gaps: [],
  });
}

function route(id: string, decisionIds: readonly string[], terminalIds: readonly string[]): Route {
  return RouteSchema.parse({
    id,
    source: 'teacher',
    decision_ids: [...decisionIds],
    terminal_ids: [...terminalIds],
    math_status: 'valid',
    evidence_refs: [],
    note: '',
  });
}

function patch(overrides: Record<string, unknown> = {}) {
  return RoutePatchSchema.parse({
    task_id: 'self-001',
    new_decisions: [],
    new_routes: [],
    evidence_refs: [],
    math_status: 'valid',
    verification: [
      { kind: 'deterministic_check', reviewer_or_model: 'code', reference: '', summary: '', status: 'pass', checked_at: new Date().toISOString() },
    ],
    blocking_issues: [],
    ...overrides,
  });
}

const baseGraph: RouteGraph = {
  decisions: [decision('d1'), decision('d2', ['d1']), decision('d3', ['d2'])],
  routes: [route('derivative', ['d1', 'd2', 'd3'], ['d3'])],
};

describe('AND/OR 结构校验', () => {
  it('合法的 AND 前提链通过', () => {
    expect(validateRouteGraph(baseGraph)).toEqual([]);
  });

  it('OR 路线：多条互不相同的路线并存即可，无需同时满足', () => {
    const withAlternative: RouteGraph = {
      decisions: [...baseGraph.decisions, decision('d4')],
      routes: [...baseGraph.routes, route('alternative', ['d1', 'd2', 'd4'], ['d4'])],
    };
    expect(validateRouteGraph(withAlternative)).toEqual([]);
  });

  it('路线引用不存在的节点时报告悬空引用', () => {
    const broken: RouteGraph = { decisions: [decision('d1')], routes: [route('r', ['d1', 'ghost'], ['d1'])] };
    expect(validateRouteGraph(broken).map((item) => item.code)).toContain('UNKNOWN_DECISION_REFERENCE');
  });

  it('终点不属于本路线时报告越界', () => {
    const broken: RouteGraph = {
      decisions: [decision('d1'), decision('d2')],
      routes: [route('r', ['d1'], ['d2'])],
    };
    expect(validateRouteGraph(broken).map((item) => item.code)).toContain('TERMINAL_NOT_IN_ROUTE');
  });

  it('前提成环时报告环，并给出具体路径', () => {
    // d1 -> d3 -> d2 -> d1
    const cyclic: RouteGraph = {
      decisions: [decision('d1', ['d3']), decision('d2', ['d1']), decision('d3', ['d2'])],
      routes: [route('r', ['d1', 'd2', 'd3'], ['d3'])],
    };
    const issues = validateRouteGraph(cyclic);
    const cycle = issues.find((item) => item.code === 'PREREQUISITE_CYCLE');
    expect(cycle).toBeDefined();
    expect(cycle?.message).toMatch(/d1 -> d3 -> d2 -> d1|d2 -> d1 -> d3 -> d2|d3 -> d2 -> d1 -> d3/);
  });

  it('环只在本路线范围内成立：跨路线的引用不构成环', () => {
    // d3 依赖 d2、d2 依赖 d1 都是路线内；d4 在另一条路线里依赖 d3。
    const crossRoute: RouteGraph = {
      decisions: [decision('d1'), decision('d2', ['d1']), decision('d3', ['d2']), decision('d4', ['d3'])],
      routes: [route('r1', ['d1', 'd2'], ['d2']), route('r2', ['d3', 'd4'], ['d4'])],
    };
    // r2 内 d4 -> d3（前提），而 d3 的前提 d2 不在 r2 中，不参与 r2 的环判定。
    expect(findCycles(['d3', 'd4'], new Map(crossRoute.decisions.map((item) => [item.id, item])))).toEqual([]);
  });

  it('决策 ID 重复时报告', () => {
    const duplicated: RouteGraph = { decisions: [decision('d1'), decision('d1')], routes: [route('r', ['d1'], ['d1'])] };
    expect(validateRouteGraph(duplicated).map((item) => item.code)).toContain('DUPLICATE_DECISION_ID');
  });
});

describe('applyRoutePatch：补丁只增不改', () => {
  it('追加新节点与新路线后可推进', () => {
    const outcome = applyRoutePatch(baseGraph, patch({
      new_decisions: [decision('d4', ['d1'])],
      new_routes: [route('alternative', ['d1', 'd4'], ['d4'])],
    }));

    expect(outcome.issues).toEqual([]);
    expect(outcome.usable).toBe(true);
    expect(outcome.graph.decisions.map((item) => item.id)).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(outcome.graph.routes.map((item) => item.id)).toEqual(['derivative', 'alternative']);
  });

  it('改写已有决策时整体拒绝，不静默丢弃冲突部分', () => {
    const outcome = applyRoutePatch(baseGraph, patch({ new_decisions: [decision('d1')] }));

    expect(outcome.usable).toBe(false);
    expect(outcome.issues.map((item) => item.code)).toContain('PATCH_OVERWRITES_EXISTING');
  });

  it('改写已有路线时整体拒绝', () => {
    const outcome = applyRoutePatch(baseGraph, patch({ new_routes: [route('derivative', ['d1'], ['d1'])] }));
    expect(outcome.issues.map((item) => item.code)).toContain('PATCH_OVERWRITES_EXISTING');
  });

  it('未核对的补丁只记录待定，不可推进结论', () => {
    const outcome = applyRoutePatch(baseGraph, patch({
      math_status: 'unknown',
      new_decisions: [decision('d4', ['d1'])],
    }));

    expect(outcome.usable).toBe(false);
    expect(outcome.issues.map((item) => item.code)).toContain('PATCH_UNVERIFIED');
    // 图仍被记录为候选，不丢弃——只是不可用于推进。
    expect(outcome.graph.decisions.map((item) => item.id)).toContain('d4');
  });

  it('补丁带阻塞项时不可推进', () => {
    const outcome = applyRoutePatch(baseGraph, patch({ blocking_issues: ['题图缺失，无法核对'] }));
    expect(outcome.usable).toBe(false);
    expect(outcome.issues.map((item) => item.code)).toContain('PATCH_HAS_BLOCKING_ISSUES');
  });

  it('补丁不可能与旧图成环——旧决策不可变，新节点无法被旧节点引用', () => {
    // 这是个结构性保证而非巧合：若旧决策能改写自己的 prerequisite_ids 去引用新节点，
    // 就会触发 PATCH_OVERWRITES_EXISTING。两条规则合起来使"补丁引入跨代环"不可达。
    const outcome = applyRoutePatch(baseGraph, patch({ new_decisions: [decision('d4', ['d2'])] }));
    expect(outcome.usable).toBe(true);
    expect(outcome.issues).toEqual([]);
  });

  it('新节点之间成环时整体不可推进', () => {
    const cyclicPatch = applyRoutePatch(
      { decisions: [], routes: [] },
      patch({
        new_decisions: [decision('y', ['z']), decision('z', ['y'])],
        new_routes: [route('r', ['y', 'z'], ['z'])],
      }),
    );
    expect(cyclicPatch.usable).toBe(false);
    expect(cyclicPatch.issues.map((item) => item.code)).toContain('PREREQUISITE_CYCLE');
  });

  it('前提落在路线之外时，本实现不报错——规格只要求"路线内 AND 无环"', () => {
    // 规格原文（contracts/README.md §3）：「同一路线按 prerequisite_ids 为 AND 无环」。
    // 环检测范围因此限定在路线内。一条前提不落在本路线的决策不构成环，
    // 本实现如实不报错，而不是自行加一条规格未要求的规则。
    const graph: RouteGraph = {
      decisions: [decision('x', ['y']), decision('y', [])],
      routes: [route('r', ['x'], ['x'])],
    };
    expect(validateRouteGraph(graph)).toEqual([]);
  });
});

describe('problem_hash 计算', () => {
  it('内容相同则哈希相同', () => {
    const input = { statementMd: 'f(x)=x+1/x', source: '自拟', isOfficial: false, assetContentHashes: ['a'] };
    expect(problemContentHash(input)).toBe(problemContentHash({ ...input }));
  });

  it('题干变更即产生新哈希', () => {
    const base = { statementMd: 'f(x)=x+1/x', source: '自拟', isOfficial: false, assetContentHashes: ['a'] };
    expect(problemContentHash(base)).not.toBe(problemContentHash({ ...base, statementMd: 'f(x)=x+2/x' }));
  });

  it('题图字节变更即产生新哈希', () => {
    const base = { statementMd: 'f(x)=x+1/x', source: '自拟', isOfficial: false, assetContentHashes: ['a'] };
    expect(problemContentHash(base)).not.toBe(problemContentHash({ ...base, assetContentHashes: ['b'] }));
  });

  it('产生 64 位小写十六进制，与契约的 pattern 一致', () => {
    const hash = problemContentHash({ statementMd: 'x', source: 's', isOfficial: false, assetContentHashes: [] });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
