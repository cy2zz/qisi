// 检验任务池。
//
// 规格依据 B02 步骤 3：「生成至少两项检验候选，未核对项不得启动检验」，
// 与 contracts/README.md §8：
//   「候选verified、未向owner展示、task_hash未见、equivalence_group未被使用，
//     且relation=near_transfer才用于新的迁移检验。near_duplicate可用作带标识练习，
//     但不作为默认重测候选，报告不能记迁移独立通过。」
//
// 池子的职责不是"挑一道题"，而是**把不合格的候选连同原因一起暴露出来**。
// 规格要求「准备失败、覆盖率和限制需可见」（AGENTS.md §6 第 1 条），
// 因此每个候选都带 eligibility 说明，而不是被静默过滤掉。

import type { CheckTask } from '../../contracts/domain.schema.js';

export interface OwnerHistory {
  /** 已向该 owner 展示过的检验题内容哈希。 */
  readonly seenTaskHashes: ReadonlySet<string>;
  /** 已被使用过的等价组。同一等价组不重复用于独立检验。 */
  readonly usedEquivalenceGroups: ReadonlySet<string>;
}

export interface CandidateEligibility {
  readonly taskId: string;
  readonly contentHash: string;
  readonly relation: CheckTask['relation'];
  readonly equivalenceGroup: string;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export const MIN_CHECK_CANDIDATES = 2;

export class CheckTaskPool {
  readonly #byProblemHash = new Map<string, CheckTask[]>();

  /**
   * 登记某题的准备包带来的检验候选。
   *
   * 少于两项时不抛错而是如实返回缺口——规格允许「无法可靠产生时留缺口」，
   * 但不允许编造候选，也不允许把不足两项当成通过。
   */
  register(problemHash: string, candidates: readonly CheckTask[]): { readonly registered: number; readonly shortfall: number } {
    const existing = this.#byProblemHash.get(problemHash) ?? [];
    const seen = new Set(existing.map((task) => task.id));
    const added = candidates.filter((task) => !seen.has(task.id));
    this.#byProblemHash.set(problemHash, [...existing, ...added]);

    const total = existing.length + added.length;
    return { registered: added.length, shortfall: Math.max(0, MIN_CHECK_CANDIDATES - total) };
  }

  candidates(problemHash: string): readonly CheckTask[] {
    return this.#byProblemHash.get(problemHash) ?? [];
  }

  /** 单条候选的可用性判定，附具体原因。 */
  eligibility(task: CheckTask, history: OwnerHistory): CandidateEligibility {
    const reasons: string[] = [];

    if (!task.verified) {
      reasons.push('候选未核对（verified=false），不得启动检验');
    }
    if (history.seenTaskHashes.has(task.content_hash)) {
      reasons.push('该任务内容已向本 owner 展示过');
    }
    if (history.usedEquivalenceGroups.has(task.equivalence_group)) {
      reasons.push(`等价组 ${task.equivalence_group} 已被使用`);
    }
    if (task.relation !== 'near_transfer') {
      reasons.push(`关联类型为 ${task.relation}，仅可作带标识练习，不计迁移独立通过`);
    }

    return {
      taskId: task.id,
      contentHash: task.content_hash,
      relation: task.relation,
      equivalenceGroup: task.equivalence_group,
      eligible: reasons.length === 0,
      reasons,
    };
  }

  /** 全部候选的可用性，用于把覆盖率与限制显式呈现给上层。 */
  eligibilityReport(problemHash: string, history: OwnerHistory): readonly CandidateEligibility[] {
    return this.candidates(problemHash).map((task) => this.eligibility(task, history));
  }

  /**
   * 为一次新的迁移检验选择候选。
   *
   * 返回 null 表示没有可用候选——这是合法结果，调用方应如实报告"无可用检验任务"，
   * 不得退而使用未核对或已展示过的题（AGENTS.md §6 第 1 条「不缩池、不在失败时暗换简单题」）。
   */
  selectForTransfer(problemHash: string, history: OwnerHistory): CheckTask | null {
    return this.candidates(problemHash).find((task) => this.eligibility(task, history).eligible) ?? null;
  }

  /** 内容哈希变更后，该题关联的候选整体退役。 */
  retire(problemHash: string): number {
    const removed = this.#byProblemHash.get(problemHash)?.length ?? 0;
    this.#byProblemHash.delete(problemHash);
    return removed;
  }

  get problemCount(): number {
    return this.#byProblemHash.size;
  }
}
