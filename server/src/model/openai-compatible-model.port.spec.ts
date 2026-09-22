import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppEnvironment } from '../config/env.js';
import { OpenAiCompatibleModelPort } from './openai-compatible-model.port.js';

function createConfig(overrides: Partial<AppEnvironment> = {}) {
  const values: Partial<AppEnvironment> = {
    AI_API_KEY: 'test-only-key',
    AI_BASE_URL: 'https://provider.example/v1',
    AI_MODEL: 'test-model',
    AI_TIMEOUT_MS: 60_000,
    ...overrides,
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


describe('interactive model latency settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubCompletion() {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      model: 'gpt-5.5-2026-04-24',
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  function interactiveRequest() {
    return { input: 'synthetic input', maxOutputTokens: 500, role: 'diagnosis' as const,
      signal: new AbortController().signal, system: 'fixture system', latencyProfile: 'interactive' as const };
  }

  it.each(['gpt-5.5', 'gpt-5.5-2026-04-24'])('explicitly disables extra reasoning for verified interactive model %s without switching models', async (model) => {
    const fetchMock = stubCompletion();
    const result = await new OpenAiCompatibleModelPort(createConfig({ AI_MODEL: model })).generate(interactiveRequest());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe('https://provider.example/v1/chat/completions');
    expect(body).toMatchObject({ model, reasoning_effort: 'none', verbosity: 'low', max_completion_tokens: 500 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(body.messages[0].content).toContain('输出使用紧凑JSON');
    expect(body.messages[0].content).toContain('必须完整保留Schema要求的字段');
    expect(result).toMatchObject({ reasoningEffort: 'none', outputVerbosity: 'low', latencyProfileVersion: 'interactive-v1', model: 'gpt-5.5-2026-04-24' });
    expect(result).not.toHaveProperty('apiKey');
  });

  it.each(['test-model', 'gpt-4.1', 'gpt-5.5-custom'])('does not guess reasoning support for %s', async (model) => {
    const fetchMock = stubCompletion();
    const result = await new OpenAiCompatibleModelPort(createConfig({ AI_MODEL: model })).generate(interactiveRequest());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty('reasoning_effort');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('verbosity');
    expect(result).not.toHaveProperty('reasoningEffort');
    expect(result).not.toHaveProperty('outputVerbosity');
    expect(JSON.parse(String(init.body)).messages[0].content).toBe('fixture system');
  });

  it('preserves provider defaults for non-interactive requests including preparation and assessment', async () => {
    for (const role of ['preparation', 'assessment'] as const) {
      const fetchMock = stubCompletion();
      const request = { ...interactiveRequest(), role, latencyProfile: undefined };
      await new OpenAiCompatibleModelPort(createConfig({ AI_MODEL: 'gpt-5.5' })).generate(request);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).not.toHaveProperty('reasoning_effort');
      expect(JSON.parse(String(init.body))).not.toHaveProperty('verbosity');
    }
  });

  it('does not silently retry with changed reasoning settings when a provider rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"fixture failure"}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new OpenAiCompatibleModelPort(createConfig({ AI_MODEL: 'gpt-5.5' })).generate(interactiveRequest()))
      .rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
