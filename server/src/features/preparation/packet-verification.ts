// 教学包核对。
//
// 规格依据 B02 步骤 4：「实现包核对Guard、循环/引用/条件/缺图负例，不以双模型一致当证明」，
// 与 B02 failure_first「AT05: 拒绝并保留needs_review；结构不充当数学认证」。
//
// 核心约束（contracts/README.md §3）：
//   「model_checked只是模型复核；human_reviewed必须有真实执行者/日期/依据，不能由模型
//     自填成真。Guard不能验证普遍数学真理，冲突和证据不足保留unknown。」
//
// 因此本模块的返回类型里 mathCertified 恒为 false——不是"当前为假"，而是**代码路径
// 上不可能产生 true**。数学正确性只能来自真实的人工核对记录，源码无法授予。这样
// 任何调用方都无法把"结构校验通过"误当成"数学已认证"。

import type { GuardResult, Packet } from '../../contracts/domain.schema.js';
import { packetReadinessIssues } from './packet-cache.js';
import { validateRouteGraph, type RouteGraphIssue, type RouteGraph } from '../../agents/preparation/route-graph.js';

export type PacketReviewStatus = 'ready' | 'needs_review';

export interface PacketReviewIssue {
  /** 来源层次：结构（Schema/图）、核对（ready 四条件）、模型（Guard）。 */
  readonly layer: 'graph' | 'readiness' | 'guard';
  readonly code: string;
  readonly message: string;
}

export interface PacketReviewOutcome {
  readonly status: PacketReviewStatus;
  readonly issues: readonly PacketReviewIssue[];
  /**
   * 恒为 false。数学认证只能来自真实人工核对，代码不得授予。
   * 字段存在的意义是让"未认证"成为显式事实，而不是靠调用方记得去查。
   */
  readonly mathCertified: false;
}

function graphIssueToReviewIssue(issue: RouteGraphIssue): PacketReviewIssue {
  return { layer: 'graph', code: issue.code, message: `${issue.path}: ${issue.message}` };
}

export interface ReviewPacketInput {
  readonly packet: Packet;
  readonly expectedProblemHash: string;
  readonly graph: RouteGraph;
  /** 模型核对结果。是**输入之一**而非权威——accept 不足以让包变为 ready。 */
  readonly guard: GuardResult | null;
}

/**
 * 核对一个教学包。
 *
 * 判定顺序：先代码（图结构 + ready 四条件），再模型（Guard）。顺序不可颠倒——
 * 模型 accept 不能覆盖结构缺陷；反之模型 revise 可以否决一个结构完备的包。
 *
 * 不通过时返回 needs_review 而**不是** rejected：规格要求保留该题待人工核对
 * （「拒绝并保留needs_review」），不得静默换题或丢弃。
 */
export function reviewPacket(input: ReviewPacketInput): PacketReviewOutcome {
  const issues: PacketReviewIssue[] = [];

  for (const graphIssue of validateRouteGraph(input.graph)) {
    issues.push(graphIssueToReviewIssue(graphIssue));
  }

  for (const readinessIssue of packetReadinessIssues(input.packet, input.expectedProblemHash)) {
    issues.push({ layer: 'readiness', code: 'PACKET_NOT_READY', message: readinessIssue });
  }

  if (input.guard !== null && input.guard.verdict !== 'accept') {
    issues.push({
      layer: 'guard',
      code: `GUARD_${input.guard.verdict.toUpperCase()}`,
      message: input.guard.math_note.length > 0 ? input.guard.math_note : `Guard 判定为 ${input.guard.verdict}`,
    });
  }

  return {
    status: issues.length === 0 ? 'ready' : 'needs_review',
    issues,
    mathCertified: false,
  };
}

/**
 * 提取可采信的人工核对记录。
 *
 * 规格（contracts/README.md §3）：「human_reviewed必须有真实执行者/日期/依据，
 * 不能由模型自填成真」。本函数只做形式检查：kind 为 human_reviewed，且执行者与
 * 依据均非空。
 *
 * **形式检查不等于真实性保证。** 一条记录是否真的来自人，取决于写入路径：
 * 只有受控的人工核对流程才能创建 human_reviewed 记录，模型输出永远走不到这里。
 * 因此本函数的调用点必须位于可信写入路径上，不能拿它去校验模型返回值。
 */
export function humanReviewEvidence(packet: Packet) {
  return packet.verification.filter(
    (record) => record.kind === 'human_reviewed' && record.reviewer_or_model.trim().length > 0 && record.reference.trim().length > 0,
  );
}
