import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../config/env.js';
import { OpenAiCompatibleModelPort } from './openai-compatible-model.port.js';

function createConfig() {
  const values: Partial<AppEnvironment> = {
    AI_API_KEY: 'test-only-key',
    AI_BASE_URL: 'https://provider.example/v1',
    AI_MODEL: 'test-model',
    AI_TIMEOUT_MS: 60_000,
  };

  return {
    get: vi.fn((key: keyof AppEnvironment) => values[key]),
  } as unknown as ConfigService<AppEnvironment, true>;
}

describe('OpenAiCompatibleModelPort', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls chat completions once and returns parsed JSON with provider metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"overview":"函数题"}' } }],
          model: 'test-model',
          usage: { completion_tokens: 12, prompt_tokens: 34 },
        }),
        {
          headers: { 'Content-Type': 'application/json', 'x-request-id': 'request-7' },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiCompatibleModelPort(createConfig());
    const result = await provider.generate({
      input: 'problem text',
      maxOutputTokens: 500,
      role: 'preparation',
      signal: new AbortController().signal,
      system: 'system prompt',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://provider.example/v1/chat/completions');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-only-key');
    expect(JSON.parse(String(init.body))).toMatchObject({
      max_completion_tokens: 500,
      model: 'test-model',
      response_format: { type: 'json_object' },
    });
    expect(result).toMatchObject({
      model: 'test-model',
      parsed: { overview: '函数题' },
      provider: 'openai-compatible',
      providerRequestId: 'request-7',
      usage: { input: 34, kind: 'reported', output: 12 },
    });
  });
});
