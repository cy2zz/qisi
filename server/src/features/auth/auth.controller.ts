import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME, authCookieOptions, readCookie } from './auth.cookie.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: unknown,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertAllowedOrigin(origin);
    const result = await this.auth.login(this.readUsername(body));
    this.setAuthCookie(response, result.token);
    return { user: result.user };
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readCookie(cookieHeader, AUTH_COOKIE_NAME);
    const user = await this.auth.authenticate(token);
    this.setAuthCookie(response, token!);
    return { user };
  }

  private assertAllowedOrigin(origin: string | undefined) {
    if (origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('origin is not allowed');
    }
  }

  private readUsername(body: unknown) {
    if (!body || typeof body !== 'object' || !('username' in body)) {
      return undefined;
    }
    return (body as { username?: unknown }).username;
  }

  private setAuthCookie(response: Response, token: string) {
    response.cookie(
      AUTH_COOKIE_NAME,
      token,
      authCookieOptions(this.config.get('NODE_ENV', { infer: true }) === 'production'),
    );
  }
}
