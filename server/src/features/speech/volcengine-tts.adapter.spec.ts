import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { VolcengineTtsAdapter } from './volcengine-tts.adapter.js';

const apiKey = 'test-volc-api-key';

function createAdapter(overrides: Partial<AppEnvironment> = {}) {
  const values: Partial<AppEnvironment> = {
    VOLC_TTS_API_KEY: apiKey,
    VOLC_TTS_RESOURCE_ID: 'seed-tts-2.0',
    VOLC_TTS_SPEAKER: 'zh_female_vv_uranus_bigtts',
    VOLC_TTS_TIMEOUT_MS: 30_000,
    ...overrides,
  };
  const config = {
    get: vi.fn((key: keyof AppEnvironment) => values[key]),
  };

  return new VolcengineTtsAdapter(
    config as unknown as ConfigService<AppEnvironment, true>,
  );
}

describe('VolcengineTtsAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a TTS 2.0 SSE request and joins the returned MP3 chunks', async () => {
    const first = Buffer.from('first-audio-chunk');
    const second = Buffer.from('second-audio-chunk');
    const providerBody = [
      'event: 352',
      `data: ${JSON.stringify({ code: 0, data: first.toString('base64'), message: '' })}`,
      '',
      'event: 352',
      `data: ${JSON.stringify({ code: 0, data: second.toString('base64'), message: '' })}`,
      '',
      'event: 351',
      `data: ${JSON.stringify({
        code: 0,
        data: null,
        message: '',
        sentence: { phonemes: [], text: '先看分式。', words: [] },
      })}`,
      '',
      'event: 152',
      `data: ${JSON.stringify({ code: 20_000_000, data: null, message: 'OK' })}`,
      '',
    ].join('\n');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(providerBody, {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200,
      }),
    );

    await expect(createAdapter().synthesize('先看分式 $\\frac{x-1}{x-3}$。')).resolves.toEqual(
      Buffer.concat([first, second]),
    );

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(new Headers(request?.headers).get('X-Api-Key')).toBe(apiKey);
    expect(new Headers(request?.headers).get('X-Api-Resource-Id')).toBe('seed-tts-2.0');

    const payload = JSON.parse(String(request?.body)) as {
      req_params: {
        additions: string;
        audio_params: { format: string; sample_rate: number };
        speaker: string;
        text: string;
      };
    };
    expect(payload.req_params.text).toBe('先看分式 $\\frac{x-1}{x-3}$。');
    expect(payload.req_params.speaker).toBe('zh_female_vv_uranus_bigtts');
    expect(payload.req_params.audio_params).toMatchObject({ format: 'mp3', sample_rate: 24_000 });
    expect(JSON.parse(payload.req_params.additions)).toMatchObject({
      disable_markdown_filter: true,
      enable_latex_tn: true,
    });
  });

  it('fails closed when the API key or a completed audio response is missing', async () => {
    await expect(createAdapter({ VOLC_TTS_API_KEY: undefined }).synthesize('测试')).rejects.toThrow(
      '火山引擎语音合成尚未配置',
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('event: 153\ndata: {"code":45000000,"message":"denied","data":null}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200,
      }),
    );
    await expect(createAdapter().synthesize('测试')).rejects.toThrow('火山引擎语音合成暂时不可用');
  });
});
