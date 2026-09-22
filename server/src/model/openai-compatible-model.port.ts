import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppEnvironment } from '../config/env.js';
import type { ModelPort, ModelRequest, ModelResponse } from './model.port.js';

const INTERACTIVE_PROFILE_VERSION = 'interactive-v1' as const;
const COMPACT_JSON_INSTRUCTION = '输出使用紧凑JSON，不使用缩进或排版换行；说明字段用简短的必要依据，避免重复叙述。必须完整保留Schema要求的字段、准确的证据引用、不确定性与必要反证，不得为了简短省略诊断或安全检查。';

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().min(1) }),
      }),
    )
    .min(1),
  model: z.string().min(1).optional(),
  usage: z
    .object({
      completion_tokens: z.number().int().nonnegative().nullish(),
      prompt_tokens: z.number().int().nonnegative().nullish(),
    })
    .passthrough()
    .optional(),
});

@Injectable()
export class OpenAiCompatibleModelPort implements ModelPort {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = this.config.get('AI_API_KEY', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('AI provider is not configured');
    }

    const baseUrl = this.config.get('AI_BASE_URL', { infer: true }).replace(/\/$/, '');
    const configuredModel = this.config.get('AI_MODEL', { infer: true });
    // 同一项目网关已验证的在线配置：避免推理token耗尽25秒节点时间。
    // 仅显式interactive请求启用；不改离线备课/Assessment默认行为，也不猜其他模型的能力。
    const reasoningEffort = request.latencyProfile === 'interactive'
      && /^gpt-5\.5(?:-\d{4}-\d{2}-\d{2})?$/.test(configuredModel)
      ? 'none' as const : undefined;
    const outputVerbosity = reasoningEffort ? 'low' as const : undefined;
    const timeoutMs = this.config.get('AI_TIMEOUT_MS', { infer: true });
    const startedAt = performance.now();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    const inputText = typeof request.input === 'string'
      ? request.input
      : JSON.stringify(request.input);
    const system = reasoningEffort ? `${request.system}\n${COMPACT_JSON_INSTRUCTION}` : request.system;
    const systemContent = request.outputSchema
      ? `${system}\n只返回符合以下 JSON Schema 的对象，不得增加字段：\n${JSON.stringify(z.toJSONSchema(request.outputSchema))}`
      : system;
    const userContent = request.images?.length
      ? [
          { text: inputText, type: 'text' },
          ...request.images.map((image) => ({
            image_url: {
              url: `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`,
            },
            type: 'image_url',
          })),
        ]
      : inputText;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        body: JSON.stringify({
          max_completion_tokens: request.maxOutputTokens,
          messages: [
            { content: systemContent, role: 'system' },
            { content: userContent, role: 'user' },
          ],
          model: configuredModel,
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort, verbosity: outputVerbosity } : {}),
          response_format: { type: 'json_object' },
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal,
      });
    } catch {
      throw new BadGatewayException('AI provider request failed');
    }

    if (!response.ok) {
      throw new BadGatewayException('AI provider returned an error');
    }

    let completion: z.infer<typeof completionSchema>;
    try {
      completion = completionSchema.parse(await response.json());
    } catch {
      throw new BadGatewayException('AI provider returned an invalid response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(completion.choices[0]!.message.content) as unknown;
    } catch {
      throw new BadGatewayException('AI provider returned invalid JSON');
    }

    return {
      ...(reasoningEffort ? { reasoningEffort, outputVerbosity, latencyProfileVersion: INTERACTIVE_PROFILE_VERSION } : {}),
      elapsedMs: Math.round(performance.now() - startedAt),
      model: completion.model ?? configuredModel,
      parsed,
      provider: 'openai-compatible',
      providerRequestId: response.headers.get('x-request-id') ?? undefined,
      usage: typeof completion.usage?.prompt_tokens === 'number'
        && typeof completion.usage.completion_tokens === 'number'
        ? {
            input: completion.usage.prompt_tokens,
            kind: 'reported',
            output: completion.usage.completion_tokens,
          }
        : { input: 0, kind: 'unknown', output: 0 },
    };
  }
}
