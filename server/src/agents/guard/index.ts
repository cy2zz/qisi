// Guard｜校验模块（owner: B，agents.json）
//
// 职责：核对候选包/路线/消息/评分的数学风险与披露边界。识别实际披露的 decision_ids；
// 有实际策略帮助但无法精确定位时 whole_task_disclosed=true。
//
// 边界：无工具权限、无状态写权限、无直接展示权限。GuardResult.accept 才可显示，
// 但 Guard 不能代替代码 PolicyGate——Guard 只是 PolicyGate 的一个输入。

import { Injectable } from '@nestjs/common';
import { GuardResultSchema, type GuardInput, type GuardResult } from '../../contracts/domain.schema.js';
import { ROLE_PROMPTS } from '../../prompts/index.js';
import { callRoleModel, type AgentCallOptions, type AgentCallResult } from '../agent-runtime.js';
import type { ModelPort } from '../../model/ports.js';

@Injectable()
export class Guard {
  readonly role = 'guard' as const;
  readonly promptVersion = ROLE_PROMPTS.guard.version;

  async run(input: GuardInput, port: ModelPort, options: AgentCallOptions): Promise<AgentCallResult<GuardResult>> {
    return callRoleModel({
      role: this.role,
      prompt: ROLE_PROMPTS.guard,
      schema: GuardResultSchema,
      input,
      port,
      options,
    });
  }
}
