import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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
      images: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }],
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
      messages: [
        { content: 'system prompt', role: 'system' },
        {
          content: [
            { text: 'problem text', type: 'text' },
            { image_url: { url: 'data:image/png;base64,AQID' }, type: 'image_url' },
          ],
          role: 'user',
        },
      ],
    });
    expect(result).toMatchObject({
      model: 'test-model',
      parsed: { overview: '函数题' },
      provider: 'openai-compatible',
      providerRequestId: 'request-7',
      usage: { input: 34, kind: 'reported', output: 12 },
    });
  });

  it('accepts compatible providers that report null token counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"overview":"函数题"}' } }],
          model: 'test-model',
          usage: { completion_tokens: null, prompt_tokens: null, total_tokens: null },
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    ));

    const provider = new OpenAiCompatibleModelPort(createConfig());
    await expect(provider.generate({
      input: 'problem text',
      maxOutputTokens: 500,
      role: 'preparation',
      signal: new AbortController().signal,
      system: 'system prompt',
    })).resolves.toMatchObject({
      parsed: { overview: '函数题' },
      usage: { input: 0, kind: 'unknown', output: 0 },
    });
  });

  it('projects a role input and its strict output schema into the provider request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"text_md":"先写出已知条件。"}' } }],
          model: 'test-model',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiCompatibleModelPort(createConfig());
    await provider.generate({
      input: { action: 'ask', task_id: 'task-1' },
      maxOutputTokens: 500,
      model: 'configured-model',
      outputSchema: z.strictObject({ text_md: z.string() }),
      role: 'renderer',
      signal: new AbortController().signal,
      system: 'renderer prompt',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: string; role: string }>;
    };
    expect(body.messages[0]?.content).toContain('renderer prompt');
    expect(body.messages[0]?.content).toContain('"text_md"');
    expect(body.messages[1]?.content).toBe('{"action":"ask","task_id":"task-1"}');
  });
});
