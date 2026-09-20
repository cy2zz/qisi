// DiagnosisAgent｜证据诊断（owner: B，agents.json）
//
// 职责：根据已确认的有效证据识别本轮卡点，不给学生贴永久能力标签。
// judgment 描述当前数学有效性，hypotheses 描述原因，两者不得合并为一个标签。
//
// 上下文边界：只有已确认且未失效的提交才会进入输入，这由 projectDiagnosisInput
// 保证（server/src/agents/context.ts），而非由提示词自律。

import { assertDiagnosisEvidence, currentEvidence } from '../../features/tutor/evidence.js';
import { Injectable } from '@nestjs/common';
import { DiagnosisInputSchema, DiagnosisSchema, type Diagnosis, type DiagnosisInput } from '../../contracts/domain.schema.js';
import { ROLE_PROMPTS } from '../../prompts/index.js';
import { callRoleModel, type AgentCallOptions, type AgentCallResult } from '../agent-runtime.js';
import type { ModelPort } from '../../model/ports.js';

@Injectable()
export class DiagnosisAgent {
  readonly role = 'diagnosis' as const;
  readonly promptVersion = ROLE_PROMPTS.diagnosis.version;

  /** Strict entry for domain workflows. Legacy analysis adapter must align task IDs before migrating. */
  async runChecked(input: DiagnosisInput, port: ModelPort, options: AgentCallOptions): Promise<AgentCallResult<Diagnosis>> {
    const checkedInput = DiagnosisInputSchema.parse(input);
    const safeInput = { ...checkedInput, confirmed_evidence: currentEvidence(checkedInput.task_id, checkedInput.confirmed_evidence) };
    const result = await callRoleModel({
      role: this.role,
      prompt: ROLE_PROMPTS.diagnosis,
      schema: DiagnosisSchema,
      input: safeInput,
      port,
      options,
    });
    assertDiagnosisEvidence(result.value, safeInput);
    return result;
  }
  /** Legacy schema-only entry; retained for A's analysis adapter until its task/revision contract is aligned. */
  async run(input: DiagnosisInput, port: ModelPort, options: AgentCallOptions): Promise<AgentCallResult<Diagnosis>> {
    return callRoleModel({ role: this.role, prompt: ROLE_PROMPTS.diagnosis, schema: DiagnosisSchema, input, port, options });
  }

}
