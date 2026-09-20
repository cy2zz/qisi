import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import type { TextToSpeechPort } from './text-to-speech.port.js';

const VOLC_TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const providerEventSchema = z.object({
  code: z.number(),
  data: z.string().nullable().optional(),
  message: z.string().optional(),
}).passthrough();

export class TextToSpeechConfigurationError extends Error {}

function parseAudioResponse(body: string) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let completed = false;

  for (const block of body.replaceAll('\r\n', '\n').split('\n\n')) {
    const lines = block.split('\n');
    const event = lines
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!data) continue;

    const parsed = providerEventSchema.safeParse(JSON.parse(data));
    if (!parsed.success) throw new Error('invalid TTS response');
    if (parsed.data.code === 20_000_000) {
      completed = true;
      continue;
    }
    if (parsed.data.code !== 0) {
      throw new Error('TTS provider rejected the request');
    }
    if (event !== '352') continue;
    if (!parsed.data.data) throw new Error('TTS provider returned an empty audio chunk');

    const chunk = Buffer.from(parsed.data.data, 'base64');
    totalBytes += chunk.length;
    if (totalBytes > MAX_AUDIO_BYTES) throw new Error('TTS audio exceeds the safe limit');
    chunks.push(chunk);
  }

  if (!completed || chunks.length === 0) throw new Error('incomplete TTS response');
  return Buffer.concat(chunks);
}

@Injectable()
export class VolcengineTtsAdapter implements TextToSpeechPort {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async synthesize(text: string) {
    const apiKey = this.config.get('VOLC_TTS_API_KEY', { infer: true });
    if (!apiKey) {
      throw new TextToSpeechConfigurationError('火山引擎语音合成尚未配置');
    }

    const response = await fetch(VOLC_TTS_URL, {
      body: JSON.stringify({
        user: { uid: 'qisi-reader' },
        req_params: {
          additions: JSON.stringify({
            disable_markdown_filter: true,
            enable_latex_tn: true,
          }),
          audio_params: {
            format: 'mp3',
            sample_rate: 24_000,
          },
          speaker: this.config.get('VOLC_TTS_SPEAKER', { infer: true }),
          text,
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-Request-Id': randomUUID(),
        'X-Api-Resource-Id': this.config.get('VOLC_TTS_RESOURCE_ID', { infer: true }),
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.config.get('VOLC_TTS_TIMEOUT_MS', { infer: true })),
    });
    if (!response.ok) throw new Error('火山引擎语音合成暂时不可用');

    try {
      return parseAudioResponse(await response.text());
    } catch {
      throw new Error('火山引擎语音合成暂时不可用');
    }
  }
}
