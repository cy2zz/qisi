// AssessmentAgent 公共适配口（owner: A，B 只定义接口与测试替身）。
//
// 归属依据：
//   agents.json             AssessmentAgent 的 owner 为 A
//   tasks.json B01          excluded_write_scope: ["server/src/agents/assessment/**"]
//   contracts/README.md §1  「B01建立Agent公共接口时为A保留assessment空导出，不抢写其业务实现」
//   B01 PRD F2              「B 定义公共适配口及测试替身；A 实现评分业务」
//
// 因此本文件只声明 A 需要实现的契约，不含任何评分逻辑，也不创建
// server/src/agents/assessment/** —— 那是 A 的目录。
//
// 独立性不由 AssessmentAgent 评定（contracts/README.md §8）：它只输出 planning /
// execution 的 correct|incorrect|unknown|unanswered 与依据，独立资格由代码依据
// 真实曝光与锁定记录计算。

import type { AssessmentInput, AssessmentOutput } from '../contracts/domain.schema.js';
import type { AgentCallOptions } from './agent-runtime.js';

export interface AssessmentAgentPort {
  readonly role: 'assessment';
  readonly promptVersion: string;
  run(input: AssessmentInput, options: AgentCallOptions): Promise<AssessmentOutput>;
}

/**
 * 适配口的使用方标记。
 *
 * 规格要求「非测试运行不得静默降级为替身」（B01 PRD F2 边界条件）。工作流因此不直接
 * 持有 AssessmentAgentPort，而持有本包装——生产装配必须显式标注 implements，
 * 测试替身必须标注 isTestDouble=true，使"当前跑的是谁"在类型与运行时都可见。
 */
export interface AssessmentAdapter {
  readonly implementation: 'provisional' | 'production';
  /** 测试替身必须为 true；生产实现必须为 false。 */
  readonly isTestDouble: boolean;
  readonly agent: AssessmentAgentPort;
}

export class AssessmentNotConfiguredError extends Error {
  constructor() {
    super(
      'AssessmentAgent 未装配：A 的评分实现尚未提供。' +
        '生产与集成环境必须显式装配 AssessmentAdapter；测试可通过 isTestDouble=true 的替身，' +
        '但不得把替身结果当作正式评分证据（B01 PRD F2、contracts/README.md §10）。',
    );
    this.name = 'AssessmentNotConfiguredError';
  }
}
