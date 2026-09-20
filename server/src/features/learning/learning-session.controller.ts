import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Patch,
} from '@nestjs/common';
import { z } from 'zod';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { LearningSessionService } from './learning-session.service.js';

const learningDraftSchema = z.object({
  markdown: z.string().max(100_000),
}).strict();

const remediationTrackSchema = z.object({
  focus: z.enum(['method', 'execution', 'evidence']).nullable(),
}).strict();

@Controller('learning/sessions')
export class LearningSessionController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LearningSessionService) private readonly sessions: LearningSessionService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Headers('cookie') cookieHeader: string | undefined) {
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return { sessions: await this.sessions.listSessions(user.id) };
  }

  @Get(':sessionId')
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('sessionId') sessionId: string,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return this.sessions.getSession(user.id, sessionId);
  }

  @Patch(':sessionId/draft')
  @Header('Cache-Control', 'no-store')
  async saveDraft(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const parsed = learningDraftSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid learning draft');
    return this.sessions.saveDraft(user.id, sessionId, parsed.data.markdown);
  }

  @Patch(':sessionId/remediation')
  @Header('Cache-Control', 'no-store')
  async updateRemediationTrack(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const parsed = remediationTrackSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid remediation track');
    return this.sessions.updateRemediationTrack(user.id, sessionId, parsed.data.focus);
  }
}
