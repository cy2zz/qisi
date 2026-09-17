// 角色调用的公共骨架。
//
// 作用有二：
//   1. 让六个角色的入口形状一致——都是「独立输入契约 → 独立输出契约」的一次调用；
//   2. 在收口处再校验一次输出结构。BudgetedModelPort 已按 outputSchema 校验过，
//      但 Agent 不应依赖调用方一定套了装饰器（测试可直接注入 FixtureProvider），
//      因此此处以 schema.parse 兜底并获得准确类型。

import type { z } from 'zod';
import type { RolePrompt } from '../prompts/index.js';
import type { ModelImage, ModelPort, ModelResponse, Role } from '../model/ports.js';

export interface AgentCallOptions {
  readonly model: string;
  readonly signal: AbortSignal;
  readonly maxOutputTokens?: number;
  readonly images?: readonly ModelImage[];
}

export interface AgentCallResult<T> {
  readonly value: T;
  /** 原始响应，供审计与节点落盘使用（provider/model/usage/时延/requestId）。 */
  readonly response: ModelResponse;
}

// 各角色输出体量差异较大：RenderedMessage 只有一段文本，Packet 含完整路线图。
// 默认值取保守上界，调用方可覆盖；实际裁剪由工作流按剩余预算决定。
const DEFAULT_MAX_OUTPUT_TOKENS: Readonly<Record<Role, number>> = {
  preparation: 4000,
  diagnosis: 2000,
  strategy: 2000,
  assessment: 2000,
  renderer: 1000,
  guard: 1000,
  vision: 2000,
};

export async function callRoleModel<T>(params: {
  readonly role: Role;
  readonly prompt: RolePrompt;
  readonly schema: z.ZodType<T>;
  readonly input: unknown;
  readonly port: ModelPort;
  readonly options: AgentCallOptions;
}): Promise<AgentCallResult<T>> {
  const { role, prompt, schema, input, port, options } = params;

  const response = await port.generate({
    role,
    model: options.model,
    system: prompt.body,
    input,
    ...(options.images === undefined ? {} : { images: options.images }),
    outputSchema: schema,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS[role],
    signal: options.signal,
  });

  // 兜底校验：装饰器已校验过时这里是恒等操作，直接调用 provider 时这里是唯一防线。
  return { value: schema.parse(response.parsed), response };
}
