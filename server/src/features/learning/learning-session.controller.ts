import { Controller, Get, Header, Headers, Inject, Param } from '@nestjs/common';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { LearningSessionService } from './learning-session.service.js';

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
}
