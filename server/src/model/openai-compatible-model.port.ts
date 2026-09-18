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
      completion_tokens: z.number().int().nonnegative(),
      prompt_tokens: z.number().int().nonnegative(),
    })
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
    const timeoutMs = this.config.get('AI_TIMEOUT_MS', { infer: true });
    const startedAt = performance.now();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        body: JSON.stringify({
          max_completion_tokens: request.maxOutputTokens,
          messages: [
            { content: request.system, role: 'system' },
            { content: request.input, role: 'user' },
          ],
          model: configuredModel,
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
      elapsedMs: Math.round(performance.now() - startedAt),
      model: completion.model ?? configuredModel,
      parsed,
      provider: 'openai-compatible',
      providerRequestId: response.headers.get('x-request-id') ?? undefined,
      usage: completion.usage
        ? {
            input: completion.usage.prompt_tokens,
            kind: 'reported',
            output: completion.usage.completion_tokens,
          }
        : { input: 0, kind: 'unknown', output: 0 },
    };
  }
}
