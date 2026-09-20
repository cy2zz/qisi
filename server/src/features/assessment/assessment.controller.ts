import {
  BadRequestException,
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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import { isAllowedWebOrigin } from '../../config/web-origin.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import {
  finishAssessmentSchema,
  requestAssessmentHelpSchema,
  saveAssessmentDraftSchema,
  submitAssessmentPlanSchema,
} from './assessment.schema.js';
import { AssessmentService } from './assessment.service.js';

@Controller('assessment')
export class AssessmentController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(AssessmentService) private readonly assessment: AssessmentService,
  ) {}

  @Get('sessions/:sessionId')
  @Header('Cache-Control', 'no-store')
  async getCurrent(
    @Param('sessionId') sessionId: string,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const user = await this.authenticate(cookieHeader);
    return this.assessment.getCurrent(user.id, sessionId);
  }

  @Post('sessions/:sessionId/start')
  @Header('Cache-Control', 'no-store')
  async start(
    @Param('sessionId') sessionId: string,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    this.assertAllowedOrigin(origin);
    const user = await this.authenticate(cookieHeader);
    return this.assessment.start(user.id, sessionId);
  }

  @Post('sessions/:sessionId/reassess')
  @Header('Cache-Control', 'no-store')
  async reassess(
    @Param('sessionId') sessionId: string,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    this.assertAllowedOrigin(origin);
    const user = await this.authenticate(cookieHeader);
    return this.assessment.reassess(user.id, sessionId);
  }

  @Patch('attempts/:attemptId/draft')
  @Header('Cache-Control', 'no-store')
  async saveDraft(
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    this.assertAllowedOrigin(origin);
    const input = this.parse(saveAssessmentDraftSchema, body);
    const user = await this.authenticate(cookieHeader);
    return this.assessment.saveDraft(user.id, attemptId, input);
  }

  @Post('attempts/:attemptId/plan')
  @Header('Cache-Control', 'no-store')
  async submitPlan(
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    this.assertAllowedOrigin(origin);
    const input = this.parse(submitAssessmentPlanSchema, body);
    const user = await this.authenticate(cookieHeader);
    return this.assessment.submitPlan(user.id, attemptId, input);
  }

  @Post('attempts/:attemptId/finish')
  @Header('Cache-Control', 'no-store')
  async finish(
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    this.assertAllowedOrigin(origin);
    const input = this.parse(finishAssessmentSchema, body);
    const user = await this.authenticate(cookieHeader);
    return this.assessment.finish(user.id, attemptId, input);
  }

  @Post('attempts/:attemptId/help')
  @Header('Cache-Control', 'no-store')
  async requestHelp(
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    this.assertAllowedOrigin(origin);
    const input = this.parse(requestAssessmentHelpSchema, body);
    const user = await this.authenticate(cookieHeader);
    return this.assessment.requestHelp(user.id, attemptId, input);
  }

  private assertAllowedOrigin(origin: string | undefined) {
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
      throw new ForbiddenException('origin is not allowed');
    }
  }

  private authenticate(cookieHeader: string | undefined) {
    return this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown) {
    const result = schema.safeParse(body);
    if (!result.success) throw new BadRequestException('invalid assessment request');
    return result.data;
  }
}
