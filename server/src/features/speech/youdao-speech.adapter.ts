import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import type { SpeechToTextPort } from './speech-to-text.port.js';

const YOUDAO_SHORT_URL = 'https://openapi.youdao.com/asrapi';
const YOUDAO_REALTIME_URL = 'wss://openapi.youdao.com/stream_asropenapi';

const shortResponseSchema = z
  .object({
    errorCode: z.string(),
    result: z.array(z.string()).optional(),
  })
  .passthrough();

export class SpeechConfigurationError extends Error {}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function truncateForSignature(value: string) {
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}${value.length}${value.slice(-10)}`;
}

export function isYoudaoRecognitionFinished(message: Record<string, unknown>) {
  return message.action === 'recognition'
    && message.errorCode === '304'
    && message.msg === 'Recognition finished';
}

@Injectable()
export class YoudaoSpeechAdapter implements SpeechToTextPort {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  private credentials() {
    const appKey = this.config.get('YOUDAO_SPEECH_APP_KEY', { infer: true });
    const appSecret = this.config.get('YOUDAO_SPEECH_APP_SECRET', { infer: true });
    if (!appKey || !appSecret) {
      throw new SpeechConfigurationError('有道语音识别尚未配置');
    }
    return { appKey, appSecret };
  }

  createRealtimeUrl() {
    const { appKey, appSecret } = this.credentials();
    const salt = randomUUID();
    const curtime = Math.floor(Date.now() / 1000).toString();
    const url = new URL(YOUDAO_REALTIME_URL);

    url.search = new URLSearchParams({
      appKey,
      channel: '1',
      curtime,
      format: 'wav',
      langType: 'zh-PURE8',
      rate: '16000',
      salt,
      sign: sha256(`${appKey}${salt}${curtime}${appSecret}`),
      signType: 'v4',
      version: 'v1',
    }).toString();
    return url.toString();
  }

  async transcribeWav(audio: Buffer) {
    const { appKey, appSecret } = this.credentials();
    const q = audio.toString('base64');
    const salt = randomUUID();
    const curtime = Math.floor(Date.now() / 1000).toString();
    const timeout = this.config.get('YOUDAO_SPEECH_TIMEOUT_MS', { infer: true });
    const form = new URLSearchParams({
      appKey,
      channel: '1',
      curtime,
      format: 'wav',
      langType: 'zh-CHS',
      q,
      rate: '16000',
      salt,
      sign: sha256(
        `${appKey}${truncateForSignature(q)}${salt}${curtime}${appSecret}`,
      ),
      signType: 'v3',
      type: '1',
    });

    const response = await fetch(YOUDAO_SHORT_URL, {
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      method: 'POST',
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      throw new Error('有道语音识别暂时不可用');
    }

    const parsed = shortResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.errorCode !== '0') {
      throw new Error('有道语音识别暂时不可用');
    }

    const transcript = parsed.data.result?.join('').trim() ?? '';
    if (!transcript) {
      throw new Error('没有识别到清晰语音');
    }
    return transcript;
  }
}
