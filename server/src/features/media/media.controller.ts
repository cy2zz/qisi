import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { QuestionImageRecognitionService } from './question-image-recognition.service.js';
import { validateQuestionImage } from './question-image-validation.js';

@Controller('media')
export class MediaController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(QuestionImageRecognitionService)
    private readonly recognition: QuestionImageRecognitionService,
  ) {}

  @Post('recognize-question')
  @Header('Cache-Control', 'no-store')
  async recognizeQuestion(
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('origin is not allowed');
    }

    const image = await validateQuestionImage(body, contentType?.split(';', 1)[0]?.trim());
    await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return {
      image: { height: image.height, width: image.width },
      recognition: await this.recognition.recognize(image),
    };
  }
}
