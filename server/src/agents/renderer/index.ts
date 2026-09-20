// Renderer｜表达模块（owner: B，agents.json）
//
// 职责：将批准的教学动作写成简洁、尊重学生的中文和 LaTeX。输出只有一个 text_md。
//
// 边界（agents.json 的 forbidden：full_reference / future_rubric / raw_diagnosis）：
// 输入由 projectRendererInput 构造，其中不存在完整私有参考、未来 rubric 或原始诊断
// 对象——Renderer 看不到它们，而不是被提示词要求忽略它们。

import { Injectable } from '@nestjs/common';
import { RenderedMessageSchema, type RenderedMessage, type RendererInput } from '../../contracts/domain.schema.js';
import { ROLE_PROMPTS } from '../../prompts/index.js';
import { normalizeRenderedMathMarkdown } from '../../shared/math-markdown.js';
import { callRoleModel, type AgentCallOptions, type AgentCallResult } from '../agent-runtime.js';
import type { ModelPort } from '../../model/ports.js';

@Injectable()
export class Renderer {
  readonly role = 'renderer' as const;
  readonly promptVersion = ROLE_PROMPTS.renderer.version;

  async run(input: RendererInput, port: ModelPort, options: AgentCallOptions): Promise<AgentCallResult<RenderedMessage>> {
    const result = await callRoleModel({
      role: this.role,
      prompt: ROLE_PROMPTS.renderer,
      schema: RenderedMessageSchema,
      input,
      port,
      options,
    });

    return {
      ...result,
      value: RenderedMessageSchema.parse({
        text_md: normalizeRenderedMathMarkdown(result.value.text_md),
      }),
    };
  }
}
