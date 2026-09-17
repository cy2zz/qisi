// DiagnosisAgent｜证据诊断（owner: B，agents.json）
//
// 职责：根据已确认的有效证据识别本轮卡点，不给学生贴永久能力标签。
// judgment 描述当前数学有效性，hypotheses 描述原因，两者不得合并为一个标签。
//
// 上下文边界：只有已确认且未失效的提交才会进入输入，这由 projectDiagnosisInput
// 保证（server/src/agents/context.ts），而非由提示词自律。

import { Injectable } from '@nestjs/common';
import { DiagnosisSchema, type Diagnosis, type DiagnosisInput } from '../../contracts/domain.schema.js';
import { ROLE_PROMPTS } from '../../prompts/index.js';
import { callRoleModel, type AgentCallOptions, type AgentCallResult } from '../agent-runtime.js';
import type { ModelPort } from '../../model/ports.js';

@Injectable()
export class DiagnosisAgent {
  readonly role = 'diagnosis' as const;
  readonly promptVersion = ROLE_PROMPTS.diagnosis.version;

  async run(input: DiagnosisInput, port: ModelPort, options: AgentCallOptions): Promise<AgentCallResult<Diagnosis>> {
    return callRoleModel({
      role: this.role,
      prompt: ROLE_PROMPTS.diagnosis,
      schema: DiagnosisSchema,
      input,
      port,
      options,
    });
  }
}
