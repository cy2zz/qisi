// prepare 工作流：备课结果的后处理管线。
//
// 职责边界：
//   * 本文件负责 prepare 与 route_review **两种模式的结果落地**——缓存、检验候选登记、
//     包核对、路线补丁合并。
//   * 模型调用与 run/lease/预算由 WorkflowOrchestrator 负责（server/src/workflows/orchestrator.ts），
//     本类不触碰 StorePort，也不创建 BudgetLedger。
//
// 这样拆分的原因：prepare 的业务规则（什么算就绪、补丁能否推进、候选够不够）是可独立
// 单测的纯逻辑，不该和事务、租约、预算缠在一起。
//
// 规格依据：B02 步骤 1–4；contracts/README.md §3（Packet 与路线图规则）、§8（检验候选规则）。

import type { CheckTask, GuardResult, Packet, RoutePatch } from '../contracts/domain.schema.js';
import { CheckTaskPool, type CandidateEligibility, MIN_CHECK_CANDIDATES } from '../features/preparation/check-task-pool.js';
import { PacketCache, packetReadinessIssues, type CachedPacket } from '../features/preparation/packet-cache.js';
import { reviewPacket, type PacketReviewOutcome } from '../features/preparation/packet-verification.js';
import { applyRoutePatch, type AppliedRouteGraph, type RouteGraph } from '../agents/preparation/route-graph.js';

export interface PreparedPacketOutcome {
  readonly status: 'ready' | 'needs_review';
  readonly packet: Packet;
  /** 实际写入缓存的条目；未就绪时为 null——不伪造缓存身份。 */
  readonly cached: CachedPacket | null;
  readonly review: PacketReviewOutcome;
  readonly checkCandidates: readonly CheckTask[];
  /** 候选不足两项时的缺口数量；0 表示满足 B02 的「至少两项」要求。 */
  readonly checkCandidateShortfall: number;
  /** 逐条候选的可用性，用于显式报告覆盖率与限制，而非静默过滤。 */
  readonly checkEligibility: readonly CandidateEligibility[];
}

export interface RoutePatchOutcome {
  readonly status: 'route_patch_applied' | 'route_patch_pending';
  readonly applied: AppliedRouteGraph;
}

export interface PrepareWorkflowDeps {
  readonly cache: PacketCache;
  readonly checkTaskPool: CheckTaskPool;
  /** 取某 wrap 题目当前的 owner 历史，用于判定检验候选可用性。 */
  readonly ownerHistory?: () => { seenTaskHashes: ReadonlySet<string>; usedEquivalenceGroups: ReadonlySet<string> };
}

export class PrepareWorkflow {
  readonly #cache: PacketCache;
  readonly #pool: CheckTaskPool;
  readonly #ownerHistory: () => {
    seenTaskHashes: ReadonlySet<string>;
    usedEquivalenceGroups: ReadonlySet<string>;
  };

  constructor(deps: PrepareWorkflowDeps) {
    this.#cache = deps.cache;
    this.#pool = deps.checkTaskPool;
    this.#ownerHistory = deps.ownerHistory ?? (() => ({ seenTaskHashes: new Set(), usedEquivalenceGroups: new Set() }));
  }

  get cache(): PacketCache {
    return this.#cache;
  }

  get checkTaskPool(): CheckTaskPool {
    return this.#pool;
  }

  /**
   * prepare 模式的结果落地。
   *
   * 顺序不可颠倒：先做核对（代码结构 + ready 四条件 + Guard），**只有就绪的包才缓存**。
   * 若先缓存后核对，一个 needs_review 的包会污染缓存并被后续会话复用。
   */
  acceptPacket(input: {
    readonly packet: Packet;
    readonly expectedProblemHash: string;
    readonly guard: GuardResult | null;
  }): PreparedPacketOutcome {
    const review = reviewPacket({
      packet: input.packet,
      expectedProblemHash: input.expectedProblemHash,
      graph: { decisions: input.packet.decisions, routes: input.packet.routes },
      guard: input.guard,
    });

    const registration = this.#pool.register(input.expectedProblemHash, input.packet.check_tasks);

    // 只有就绪包进入缓存，并把真实写入的条目返回给调用方。
    // 未就绪时返回 null，而不是编一个"看起来像缓存条目"的对象——
    // 那会让调用方误以为包已缓存。
    const cached = review.status === 'ready' ? this.#cache.put(input.expectedProblemHash, input.packet) : null;

    const history = this.#ownerHistory();
    return {
      status: review.status,
      packet: input.packet,
      cached,
      review,
      checkCandidates: input.packet.check_tasks,
      checkCandidateShortfall: registration.shortfall,
      checkEligibility: this.#pool.eligibilityReport(input.expectedProblemHash, history),
    };
  }

  /**
   * route_review 模式的结果落地。
   *
   * 补丁是**候选数据**：未核对（math_status !== valid）或结构有问题时只记录待定，
   * 状态为 route_patch_pending，不得据此推进后续结论（规格原文：「未核对路线只记录
   * 待定，不可用它推进错误结论」）。
   */
  acceptRoutePatch(current: RouteGraph, patch: RoutePatch): RoutePatchOutcome {
    const applied = applyRoutePatch(current, patch);
    return {
      status: applied.usable ? 'route_patch_applied' : 'route_patch_pending',
      applied,
    };
  }

  /**
   * 加载已缓存的包。未命中返回 null —— 调用方据此重新备课，绝不退用旧哈希的包。
   * 题干或题图变更会改变 problem_hash，因此这里天然不会命中旧包（AT06）。
   */
  loadCached(problemHash: string): Packet | null {
    return this.#cache.get(problemHash)?.packet ?? null;
  }

  /** 题目被证实有误或人工修订后，退役该题的全部派生数据。 */
  retireProblem(problemHash: string): { readonly cachedRemoved: number; readonly candidatesRemoved: number } {
    return {
      cachedRemoved: this.#cache.invalidateProblem(problemHash),
      candidatesRemoved: this.#pool.retire(problemHash),
    };
  }

  /**
   * 报告某题的准备缺口，供覆盖率与限制呈现（AGENTS.md §6 第 1 条
   * 「准备失败、覆盖率和限制需可见」）。
   */
  describeGaps(problemHash: string): readonly string[] {
    const gaps: string[] = [];
    const packet = this.loadCached(problemHash);

    if (packet === null) {
      gaps.push('该题没有就绪的教学包');
    } else {
      gaps.push(...packetReadinessIssues(packet, problemHash));
    }

    const candidates = this.#pool.candidates(problemHash);
    if (candidates.length < MIN_CHECK_CANDIDATES) {
      gaps.push(`检验候选 ${candidates.length} 项，少于要求的 ${MIN_CHECK_CANDIDATES} 项`);
    }

    const history = this.#ownerHistory();
    for (const eligibility of this.#pool.eligibilityReport(problemHash, history)) {
      if (!eligibility.eligible) {
        gaps.push(`候选 ${eligibility.taskId} 不可用：${eligibility.reasons.join('；')}`);
      }
    }

    return gaps;
  }
}
