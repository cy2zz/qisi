import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  Param,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../../config/env.js';
import { isAllowedWebOrigin } from '../../config/web-origin.js';
import { DeleteService } from '../../shared/delete.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { HistoryService } from './history.service.js';

@Controller('history')
export class HistoryController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(DeleteService) private readonly deletion: DeleteService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Headers('cookie') cookieHeader: string | undefined) {
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return this.history.getHistory(user.id);
  }

  @Delete('sessions/:sessionId')
  @Header('Cache-Control', 'no-store')
  async deleteSession(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
      throw new ForbiddenException('origin is not allowed');
    }
    if (!body || typeof body !== 'object' || (body as { confirm?: unknown }).confirm !== true) {
      throw new BadRequestException('explicit deletion confirmation is required');
    }
    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    return this.deletion.deleteSession(user.id, sessionId);
  }
}
