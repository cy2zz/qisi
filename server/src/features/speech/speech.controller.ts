import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { SpeechMathFormatterService } from './speech-math-formatter.service.js';
import { SPEECH_TO_TEXT_PORT, type SpeechToTextPort } from './speech-to-text.port.js';
import { SpeechConfigurationError } from './youdao-speech.adapter.js';

const MAX_WAV_BYTES = 2_000_044;
const formatMathDraftSchema = z.object({
  text: z.string().trim().min(1).max(12_000),
}).strict();

function isSupportedWav(body: unknown): body is Buffer {
  if (!Buffer.isBuffer(body) || body.length < 44 || body.length > MAX_WAV_BYTES) return false;
  return (
    body.toString('ascii', 0, 4) === 'RIFF' &&
    body.toString('ascii', 8, 12) === 'WAVE' &&
    body.toString('ascii', 12, 16) === 'fmt ' &&
    body.readUInt16LE(20) === 1 &&
    body.readUInt16LE(22) === 1 &&
    body.readUInt32LE(24) === 16_000 &&
    body.readUInt16LE(34) === 16 &&
    body.toString('ascii', 36, 40) === 'data'
  );
}

@Controller('speech')
export class SpeechController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(SPEECH_TO_TEXT_PORT) private readonly speech: SpeechToTextPort,
    @Inject(SpeechMathFormatterService) private readonly formatter: SpeechMathFormatterService,
  ) {}

  @Post('format-math')
  @Header('Cache-Control', 'no-store')
  async formatMathDraft(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('origin is not allowed');
    }
    const parsed = formatMathDraftSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('text must be between 1 and 12000 characters');
    }

    await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const draft = await this.formatter.format(parsed.data.text);
    return {
      formatted: draft.formatted,
      markdown: draft.markdown,
    };
  }

  @Post('transcribe')
  @Header('Cache-Control', 'no-store')
  async transcribe(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('origin is not allowed');
    }
    if (!isSupportedWav(body)) {
      throw new BadRequestException('audio must be 16kHz 16-bit mono WAV and no longer than 60 seconds');
    }

    await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    try {
      const rawTranscript = await this.speech.transcribeWav(body);
      const draft = await this.formatter.format(rawTranscript);
      return {
        formulaFormatted: draft.formatted,
        rawTranscript,
        transcript: draft.markdown,
      };
    } catch (error) {
      if (error instanceof SpeechConfigurationError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw new BadGatewayException('语音识别暂时不可用，请重试');
    }
  }
}
