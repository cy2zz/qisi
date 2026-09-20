// 教学路线图：AND/OR 结构、补丁合并与结构判定。
//
// 规格依据 contracts/README.md §3：
//   「主图2–12个关键决策为目标，Schema允许1–24；每个 Route.decision_ids 引用存在节点、
//     terminal_ids 是其中元素；同一路线按 prerequisite_ids 为 AND 无环；routes 是 OR 选择。
//     一个新路线补丁不得改写旧有效证据；未核对路线只记录待定，不可用它推进错误结论。」
//
// 设计要点（见 docs/adr/001-orchestration.md §7）：applyRoutePatch 是**应用层纯函数**，
// 承载成环检测、悬空引用与终点归属校验，可独立单测。其输出是候选数据，经 Guard 与
// 代码 PolicyGate 通过后才成为新的 packets 版本行——模型输出不得直接改写已有效证据。

import { createHash } from 'node:crypto';
import type { Decision, Route, RoutePatch } from '../../contracts/domain.schema.js';

export interface RouteGraph {
  readonly decisions: readonly Decision[];
  readonly routes: readonly Route[];
}

export type RouteGraphIssueCode =
  | 'DUPLICATE_DECISION_ID'
  | 'DUPLICATE_ROUTE_ID'
  | 'PATCH_OVERWRITES_EXISTING'
  | 'UNKNOWN_DECISION_REFERENCE'
  | 'TERMINAL_NOT_IN_ROUTE'
  | 'PREREQUISITE_CYCLE'
  | 'PATCH_UNVERIFIED'
  | 'PATCH_HAS_BLOCKING_ISSUES';

export interface RouteGraphIssue {
  readonly code: RouteGraphIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface AppliedRouteGraph {
  readonly graph: RouteGraph;
  readonly issues: readonly RouteGraphIssue[];
  /**
   * 补丁是否可用于推进教学。未核对（math_status !== 'valid'）或存在阻塞项时为 false，
   * 此时图仍被记录为候选，但不得用它得出结论——对应规格的「只记录待定」。
   */
  readonly usable: boolean;
}

const issue = (code: RouteGraphIssueCode, path: string, message: string): RouteGraphIssue => ({ code, path, message });

/** 在给定节点子集内按 prerequisite_ids 做环检测。AND 前提的环只在本路线内成立。 */
export function findCycles(decisionIds: readonly string[], decisionsById: ReadonlyMap<string, Decision>): string[][] {
  const scope = new Set(decisionIds);
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      cycles.push(trail.slice(trail.indexOf(id)));
      return;
    }
    state.set(id, 'visiting');
    for (const prerequisite of decisionsById.get(id)?.prerequisite_ids ?? []) {
      if (scope.has(prerequisite)) visit(prerequisite, [...trail, id]);
    }
    state.set(id, 'done');
  };

  for (const id of decisionIds) visit(id, []);
  return cycles;
}

/** 对一张完整图做结构校验：引用完整性、终点归属、AND 无环、OR 路线互异。 */
export function validateRouteGraph(graph: RouteGraph): RouteGraphIssue[] {
  const issues: RouteGraphIssue[] = [];
  const decisionsById = new Map<string, Decision>();

  for (const [index, decision] of graph.decisions.entries()) {
    if (decisionsById.has(decision.id)) {
      issues.push(issue('DUPLICATE_DECISION_ID', `decisions.${index}`, `决策 ID 重复：${decision.id}`));
      continue;
    }
    decisionsById.set(decision.id, decision);
  }

  const routeIds = new Set<string>();
  for (const route of graph.routes) {
    if (routeIds.has(route.id)) {
      issues.push(issue('DUPLICATE_ROUTE_ID', `routes.${route.id}`, `路线 ID 重复：${route.id}`));
    }
    routeIds.add(route.id);

    const inRoute = new Set(route.decision_ids);
    for (const decisionId of route.decision_ids) {
      if (!decisionsById.has(decisionId)) {
        issues.push(
          issue('UNKNOWN_DECISION_REFERENCE', `routes.${route.id}.decision_ids`, `决策 ${decisionId} 不存在`),
        );
      }
    }
    for (const terminalId of route.terminal_ids) {
      if (!inRoute.has(terminalId)) {
        issues.push(
          issue('TERMINAL_NOT_IN_ROUTE', `routes.${route.id}.terminal_ids`, `终点 ${terminalId} 不属于本路线`),
        );
      }
    }
    for (const cycle of findCycles(route.decision_ids, decisionsById)) {
      issues.push(
        issue('PREREQUISITE_CYCLE', `routes.${route.id}`, `AND 前提成环：${[...cycle, cycle[0]].join(' -> ')}`),
      );
    }
  }

  for (const [index, decision] of graph.decisions.entries()) {
    for (const prerequisite of decision.prerequisite_ids) {
      if (!decisionsById.has(prerequisite)) {
        issues.push(
          issue(
            'UNKNOWN_DECISION_REFERENCE',
            `decisions.${index}.prerequisite_ids`,
            `决策 ${decision.id} 的前提 ${prerequisite} 不存在`,
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * 把 route_review 产出的补丁合并进当前图。
 *
 * 补丁只能**追加**，不得改写已有节点或路线——规格明确「一个新路线补丁不得改写旧有效证据」。
 * 违反时整体拒绝，而不是丢弃冲突部分后假装成功：静默裁剪会让调用方误以为补丁已生效。
 */
export function applyRoutePatch(current: RouteGraph, patch: RoutePatch): AppliedRouteGraph {
  const issues: RouteGraphIssue[] = [];

  const existingDecisionIds = new Set(current.decisions.map((decision) => decision.id));
  const existingRouteIds = new Set(current.routes.map((route) => route.id));

  for (const decision of patch.new_decisions) {
    if (existingDecisionIds.has(decision.id)) {
      issues.push(
        issue('PATCH_OVERWRITES_EXISTING', `new_decisions.${decision.id}`, `补丁试图改写已有决策 ${decision.id}`),
      );
    }
  }
  for (const route of patch.new_routes) {
    if (existingRouteIds.has(route.id)) {
      issues.push(issue('PATCH_OVERWRITES_EXISTING', `new_routes.${route.id}`, `补丁试图改写已有路线 ${route.id}`));
    }
  }

  if (patch.math_status !== 'valid') {
    issues.push(
      issue(
        'PATCH_UNVERIFIED',
        'math_status',
        `补丁数学状态为 ${patch.math_status}，只能记录待定，不得据此推进结论`,
      ),
    );
  }
  if (patch.blocking_issues.length > 0) {
    issues.push(issue('PATCH_HAS_BLOCKING_ISSUES', 'blocking_issues', `补丁存在阻塞项：${patch.blocking_issues.join('; ')}`));
  }

  const merged: RouteGraph = {
    decisions: [...current.decisions, ...patch.new_decisions],
    routes: [...current.routes, ...patch.new_routes],
  };

  // 合并后再做一次整体结构校验：新节点可能与旧图形成环或悬空引用。
  issues.push(...validateRouteGraph(merged));

  // 可用于推进教学的必要条件：数学状态为 valid、无阻塞项、且结构校验零问题。
  // 三者缺一即只作候选记录——对应规格的「未核对路线只记录待定，不可用它推进错误结论」。
  const usable = patch.math_status === 'valid' && patch.blocking_issues.length === 0 && issues.length === 0;

  return { graph: merged, issues, usable };
}

/** 从题库内容计算 problem_hash。公式见 contracts/README.md §3。 */
export function problemContentHash(input: {
  readonly statementMd: string;
  readonly source: string;
  readonly isOfficial: boolean;
  readonly assetContentHashes: readonly string[];
}): string {
  // 规范 JSON：键排序、UTF8、LF，不做可能改题意的空白/符号等价化。
  const canonical = JSON.stringify({
    asset_content_hashes: [...input.assetContentHashes],
    is_official: input.isOfficial,
    source: input.source,
    statement_md: input.statementMd,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
