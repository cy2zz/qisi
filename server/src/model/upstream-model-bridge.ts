// 上游模型端口桥接：让 B 的 Agent 链路使用 A 已交付的真实 provider。
//
// 背景：server/src/model/ 下存在两套并行的 ModelPort 定义——
//   * ports.ts      （B，B01 交付）：ModelRequest 含 outputSchema 与 images
//   * model.port.ts （A，eae8d12）：无 outputSchema、无 images，多 DI 符号 MODEL_PORT
// 规格 §12 把该目录划给 B，§3 又规定「不得建立第二套模型 I/O」，两套并存是待裁定的
// 接口冲突。本文件是**过渡桥接**，不新增第三套定义：它实现 B 的 ModelPort，
// 内部委托给 A 的 ModelPort。统一方向由项目方裁定后，本文件应被删除或并入统一实现。
//
// 为什么不在 A 的适配器上改：AGENTS.md §4「不能以顺手修一下改对方文件」。
// 项目方亦明确「只完成 B 的工作，别动 A 的；A 有就适配」。
//
// 【两项能力降级，必须知晓】
//
// 1. 按角色的模型路由失效。B 的 ModelRequest.model 会被忽略——A 的适配器只读配置项
//    AI_MODEL，一个部署只有一个模型。B01 的 OrchestratorConfig.models 因此形同虚设。
//    这不影响正确性，但会让「分角色预算与路由」退化为单模型。
//
// 2. 视觉不支持。A 的请求体没有图片字段。本桥接**显式拒绝**带图请求，
//    而不是把图悄悄丢掉——丢了图之后模型仍会返回一段看似合理的文本，
//    那会被当成真实转写结果，属静默错误。规格要求「不支持的图片/usage 明确拒绝
//    或按契约估算」（stack-cases.json ST05 负例）。

import { z } from 'zod';
import type { ModelPort as UpstreamModelPort, ModelRole } from './model.port.js';
import type { ModelPort, ModelRequest, ModelResponse } from './ports.js';

/**
 * 上游不具备该能力。显式失败而非降级——降级会让错误在更远处才暴露，
 * 且视觉降级尤其危险：无图请求照样会返回文本。
 */
export class UpstreamCapabilityError extends Error {
  readonly capability: 'images';
  readonly role: string;

  constructor(capability: 'images', role: string, detail: string) {
    super(`上游模型端口不支持 ${capability}（role=${role}）：${detail}`);
    this.name = 'UpstreamCapabilityError';
    this.capability = capability;
    this.role = role;
  }
}

/**
 * 把 B 的 input 交给 A 的适配器。
 *
 * A 的 ModelRequest.input 是 string，故此处序列化。序列化失败时抛错而不是
 * 传 "[object Object]"——后者会让模型收到无意义输入并返回貌似合理的输出。
 */
function serialiseInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    const serialised = JSON.stringify(input);
    if (serialised === undefined) {
      throw new Error('input 不可序列化（undefined）');
    }
    return serialised;
  } catch (error) {
    throw new Error(`模型输入无法序列化为 JSON：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/**
 * 构造交给上游的 system：把输出契约以 JSON Schema 形式告知模型。
 *
 * 上游适配器有两个约束，必须在这里补上，否则每次调用都会失败：
 *
 * 1. **不接收 outputSchema。** B 的 ModelRequest.outputSchema 在本桥接被丢弃
 *    （上游接口没有该字段），因此模型**看不到契约**。而规格包的角色提示是中文散文
 *    （「输出Diagnosis。judgment与hypotheses分开……」），通篇没有字段名。
 *    实测确认：仅凭该提示，模型会自造字段（返回 gap_type/description 而非
 *    kind/explanation/missing_evidence），结构校验必然失败。故此处把 Zod schema
 *    转成 JSON Schema 一并下发。
 *
 * 2. **无条件设置 `response_format: {type:'json_object'}`**，而 OpenAI 兼容网关要求
 *    messages 中出现 "json" 字样，否则返回
 *      400 'messages' must contain the word 'json' in some form...
 *    规格包提示词不含该字样。实测确认：真实 diagnosis 提示直接 400。
 *    下面的说明文字同时满足这一要求。
 *
 * 为什么不改提示词：提示词与规格包逐字节一致是 B01 建立的保证，由 prompts.spec.ts
 * 三方比对守住。为迎合 provider 的传输层要求而改提示词会让该保证失效；这两条约束
 * 都是上游适配器的请求形态带来的，属桥接层职责。
 */
function buildUpstreamSystem(system: string, outputSchema: z.ZodType): string {
  let schemaText: string;
  try {
    // Zod 4 内置转换，产出 draft 2020-12。
    schemaText = JSON.stringify(z.toJSONSchema(outputSchema));
  } catch (error) {
    throw new Error(
      `输出契约无法转换为 JSON Schema，无法告知模型：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return [
    system,
    '',
    '严格按以下 JSON Schema 返回**一个 JSON 对象**，不要输出 JSON 之外的任何文字，不要增删字段：',
    schemaText,
  ].join('\n');
}

export class UpstreamModelBridge implements ModelPort {
  readonly #upstream: UpstreamModelPort;

  constructor(upstream: UpstreamModelPort) {
    this.#upstream = upstream;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.images !== undefined && request.images.length > 0) {
      throw new UpstreamCapabilityError(
        'images',
        request.role,
        `收到 ${request.images.length} 张图。视觉链路需 A03 的转写能力，当前上游适配器仅支持纯文本。`,
      );
    }

    // 注意：request.model 在此被有意忽略——上游只读配置项 AI_MODEL，无法按请求指定。
    // outputSchema 不被丢弃，而是转成 JSON Schema 注入 system，见 buildUpstreamSystem。
    const upstreamResponse = await this.#upstream.generate({
      input: serialiseInput(request.input),
      maxOutputTokens: request.maxOutputTokens,
      role: request.role as ModelRole,
      signal: request.signal,
      system: buildUpstreamSystem(request.system, request.outputSchema),
    });

    return {
      parsed: upstreamResponse.parsed,
      ...(upstreamResponse.providerRequestId === undefined
        ? {}
        : { providerRequestId: upstreamResponse.providerRequestId }),
      usage: upstreamResponse.usage,
      elapsedMs: upstreamResponse.elapsedMs,
      provider: upstreamResponse.provider,
      model: upstreamResponse.model,
    };
  }
}
