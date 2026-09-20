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
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import { isAllowedWebOrigin } from '../../config/web-origin.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { SpeechMathFormatterService } from './speech-math-formatter.service.js';
import { SPEECH_TO_TEXT_PORT, type SpeechToTextPort } from './speech-to-text.port.js';
import { TEXT_TO_SPEECH_PORT, type TextToSpeechPort } from './text-to-speech.port.js';
import { SpeechConfigurationError } from './youdao-speech.adapter.js';
import { TextToSpeechConfigurationError } from './volcengine-tts.adapter.js';

const MAX_WAV_BYTES = 2_000_044;
const formatMathDraftSchema = z.object({
  text: z.string().trim().min(1).max(12_000),
}).strict();
const synthesizeSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
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
    @Inject(TEXT_TO_SPEECH_PORT) private readonly textToSpeech: TextToSpeechPort,
    @Inject(SpeechMathFormatterService) private readonly formatter: SpeechMathFormatterService,
  ) {}

  @Post('synthesize')
  @Header('Cache-Control', 'private, no-store')
  async synthesize(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
      throw new ForbiddenException('origin is not allowed');
    }
    const parsed = synthesizeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('text must be between 1 and 4000 characters');
    }

    await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    try {
      const audio = await this.textToSpeech.synthesize(parsed.data.text);
      return new StreamableFile(audio, {
        disposition: 'inline',
        type: 'audio/mpeg',
      });
    } catch (error) {
      if (error instanceof TextToSpeechConfigurationError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw new BadGatewayException('朗读暂时不可用，请重试');
    }
  }

  @Post('format-math')
  @Header('Cache-Control', 'no-store')
  async formatMathDraft(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
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
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
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
