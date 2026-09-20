import { Controller, Get, Header, Headers, Inject, Param } from '@nestjs/common';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { ReportService } from './report.service.js';

@Controller('reports/sessions')
export class ReportController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  @Get(':sessionId')
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('sessionId') sessionId: string,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return this.reports.getReport(user.id, sessionId);
  }
}
