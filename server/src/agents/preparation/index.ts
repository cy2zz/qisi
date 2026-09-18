// PreparationAgent｜备课与路线审查（owner: B，agents.json）
//
// 职责：为给定题建立可核对的关键决策与可选路线；route_review 只检查学生提出的
// 路线并返回局部补丁。不读取用户身份、不自称人工审题、不直接显示答案。
//
// 输出按 mode 选择 Packet 或 RoutePatch。此处用可辨识结果而非裸联合类型，
// 使调用方无需在运行时重新判断 mode 即可安全取用（TS 无法从裸联合自动收窄）。

import { Injectable } from '@nestjs/common';
import { PacketSchema, RoutePatchSchema, type Packet, type PreparationInput, type RoutePatch } from '../../contracts/domain.schema.js';
import { ROLE_PROMPTS } from '../../prompts/index.js';
import { callRoleModel, type AgentCallOptions } from '../agent-runtime.js';
import type { ModelPort, ModelResponse } from '../../model/ports.js';

export type PreparationResult =
  | { readonly mode: 'prepare'; readonly packet: Packet; readonly response: ModelResponse }
  | { readonly mode: 'route_review'; readonly patch: RoutePatch; readonly response: ModelResponse };

@Injectable()
export class PreparationAgent {
  readonly role = 'preparation' as const;
  readonly promptVersion = ROLE_PROMPTS.preparation.version;

  async run(input: PreparationInput, port: ModelPort, options: AgentCallOptions): Promise<PreparationResult> {
    if (input.mode === 'prepare') {
      const { value, response } = await callRoleModel({
        role: this.role,
        prompt: ROLE_PROMPTS.preparation,
        schema: PacketSchema,
        input,
        port,
        options,
      });
      return { mode: 'prepare', packet: value, response };
    }

    const { value, response } = await callRoleModel({
      role: this.role,
      prompt: ROLE_PROMPTS.preparation,
      schema: RoutePatchSchema,
      input,
      port,
      options,
    });
    return { mode: 'route_review', patch: value, response };
  }
}
