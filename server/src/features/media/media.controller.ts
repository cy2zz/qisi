import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import { ConfirmTranscriptInputSchema } from '../../contracts/domain.schema.js';
import { isAllowedWebOrigin } from '../../config/web-origin.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { MediaService } from './media.service.js';
import { QuestionImageRecognitionService } from './question-image-recognition.service.js';
import { validateQuestionImage } from './question-image-validation.js';

@Controller('media')
export class MediaController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(QuestionImageRecognitionService)
    private readonly recognition: QuestionImageRecognitionService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Post('recognize-question')
  @Header('Cache-Control', 'no-store')
  async recognizeQuestion(
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
      throw new ForbiddenException('origin is not allowed');
    }

    const image = await validateQuestionImage(body, contentType?.split(';', 1)[0]?.trim());
    await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return {
      image: { height: image.height, width: image.width },
      recognition: await this.recognition.recognize(image),
    };
  }

  @Post('handwriting')
  @Header('Cache-Control', 'no-store')
  async transcribeHandwriting(
    @Body() body: unknown,
    @Query('sessionId') sessionId: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
      throw new ForbiddenException('origin is not allowed');
    }
    const parsedSessionId = sessionId === undefined
      ? null
      : z.string().regex(/^[1-9]\d*$/).parse(sessionId);
    const image = await validateQuestionImage(body, contentType?.split(';', 1)[0]?.trim());
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return this.media.transcribeHandwriting(user.id, parsedSessionId, image);
  }

  @Patch('transcripts/:transcriptId/confirm')
  @Header('Cache-Control', 'no-store')
  async confirmTranscript(
    @Param('transcriptId') transcriptId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
      throw new ForbiddenException('origin is not allowed');
    }
    z.string().regex(/^[1-9]\d*$/).parse(transcriptId);
    const parsed = ConfirmTranscriptInputSchema.parse(body);
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return this.media.confirmTranscript(user.id, transcriptId, parsed);
  }

  @Get(':mediaId')
  @Header('Cache-Control', 'private, no-store')
  async readMedia(
    @Param('mediaId') mediaId: string,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: Response,
  ) {
    z.string().regex(/^[1-9]\d*$/).parse(mediaId);
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const media = await this.media.readOwnedMedia(user.id, mediaId);
    response.type(media.mime).send(media.bytes);
  }
}
