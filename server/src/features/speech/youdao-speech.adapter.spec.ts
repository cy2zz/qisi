import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import {
  isYoudaoRecognitionFinished,
  YoudaoSpeechAdapter,
} from './youdao-speech.adapter.js';

const appKey = 'test-app-key';
const appSecret = 'test-app-secret';

function createAdapter() {
  const values: Partial<AppEnvironment> = {
    YOUDAO_SPEECH_APP_KEY: appKey,
    YOUDAO_SPEECH_APP_SECRET: appSecret,
    YOUDAO_SPEECH_TIMEOUT_MS: 25_000,
  };
  const config = {
    get: vi.fn((key: keyof AppEnvironment) => values[key]),
  };

  return new YoudaoSpeechAdapter(
    config as unknown as ConfigService<AppEnvironment, true>,
  );
}

describe('YoudaoSpeechAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('signs and sends a WAV file to the short speech API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errorCode: '0', result: ['x平方减三x加一'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const audio = Buffer.from('RIFF-test-WAVE-audio');

    await expect(createAdapter().transcribeWav(audio)).resolves.toBe('x平方减三x加一');

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const form = new URLSearchParams(String(request?.body));
    const encodedAudio = audio.toString('base64');
    const truncated = `${encodedAudio.slice(0, 10)}${encodedAudio.length}${encodedAudio.slice(-10)}`;
    const expectedSign = createHash('sha256')
      .update(`${appKey}${truncated}${form.get('salt')}${form.get('curtime')}${appSecret}`)
      .digest('hex');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openapi.youdao.com/asrapi',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(form.get('q')).toBe(encodedAudio);
    expect(form.get('langType')).toBe('zh-CHS');
    expect(form.get('format')).toBe('wav');
    expect(form.get('rate')).toBe('16000');
    expect(form.get('channel')).toBe('1');
    expect(form.get('signType')).toBe('v3');
    expect(form.get('sign')).toBe(expectedSign);
  });

  it('creates a signed realtime URL without exposing the app secret', () => {
    const url = new URL(createAdapter().createRealtimeUrl());
    const salt = url.searchParams.get('salt');
    const curtime = url.searchParams.get('curtime');
    const expectedSign = createHash('sha256')
      .update(`${appKey}${salt}${curtime}${appSecret}`)
      .digest('hex');

    expect(url.origin).toBe('wss://openapi.youdao.com');
    expect(url.pathname).toBe('/stream_asropenapi');
    expect(url.searchParams.get('langType')).toBe('zh-PURE8');
    expect(url.searchParams.get('signType')).toBe('v4');
    expect(url.searchParams.get('sign')).toBe(expectedSign);
    expect(url.toString()).not.toContain(appSecret);
  });

  it('rejects a provider error without returning the provider payload as transcript', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errorCode: '202' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(createAdapter().transcribeWav(Buffer.from('audio'))).rejects.toThrow(
      '有道语音识别暂时不可用',
    );
  });

  it('only treats the documented realtime 304 completion message as success', () => {
    expect(isYoudaoRecognitionFinished({
      action: 'recognition',
      errorCode: '304',
      msg: 'Recognition finished',
    })).toBe(true);
    expect(isYoudaoRecognitionFinished({ action: 'error', errorCode: '304' })).toBe(false);
  });
});
