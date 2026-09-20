// StrategyAgent｜教学策略（owner: B，agents.json）
//
// 职责：根据当前诊断与用户意图，选最小必要但有效的下一教学动作。
// 从七类 intervention 选择；不需要干预时 observe。
//
// 边界：不改变预算、不授予独立资格。remaining_probes / remaining_calls 只作为
// 输入被告知剩余量，策略无权增减——预算由 PolicyGate 与 BudgetLedger 掌管。

import { assertStrategyPolicy } from '../../workflows/policy.js';
import { Injectable } from '@nestjs/common';
import { StrategyInputSchema, StrategySchema, type Strategy, type StrategyInput } from '../../contracts/domain.schema.js';
import { ROLE_PROMPTS } from '../../prompts/index.js';
import { callRoleModel, type AgentCallOptions, type AgentCallResult } from '../agent-runtime.js';
import type { ModelPort } from '../../model/ports.js';

@Injectable()
export class StrategyAgent {
  readonly role = 'strategy' as const;
  readonly promptVersion = ROLE_PROMPTS.strategy.version;

  async runChecked(input: StrategyInput, port: ModelPort, options: AgentCallOptions): Promise<AgentCallResult<Strategy>> {
    const checkedInput = StrategyInputSchema.parse(input);
    const result = await callRoleModel({
      role: this.role,
      prompt: ROLE_PROMPTS.strategy,
      schema: StrategySchema,
      input: checkedInput,
      port,
      options,
    });
    assertStrategyPolicy(result.value, checkedInput);
    return result;
  }
  /** Legacy schema-only entry until A's analysis adapter adopts the pre-render policy/error contract. */
  async run(input: StrategyInput, port: ModelPort, options: AgentCallOptions): Promise<AgentCallResult<Strategy>> {
    return callRoleModel({ role: this.role, prompt: ROLE_PROMPTS.strategy, schema: StrategySchema, input, port, options });
  }

}
