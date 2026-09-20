import { Body, Controller, Header, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { TEACHER_COOKIE, TeacherService } from './teacher.service.js';
@Controller('teacher')
export class TeacherController {
 constructor(@Inject(TeacherService) private readonly teacher: TeacherService) {}
 @Post('login') @HttpCode(200) @Header('Cache-Control', 'no-store')
 async login(@Body() body: unknown, @Headers('origin') origin: string | undefined, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
  const login = await this.teacher.login(body, origin, request.ip ?? request.socket.remoteAddress ?? 'unknown');
  response.cookie(TEACHER_COOKIE, login.token, { httpOnly: true, sameSite: 'lax', secure: this.teacher.options.secureCookie, path: '/api/teacher', maxAge: login.maxAge });
  return { authenticated: true };
 }
 @Post('logout') @HttpCode(200) @Header('Cache-Control', 'no-store')
 async logout(@Headers('cookie') cookie: string | undefined, @Headers('origin') origin: string | undefined, @Res({ passthrough: true }) response: Response) {
  await this.teacher.logout(readCookie(cookie, TEACHER_COOKIE), origin);
  response.clearCookie(TEACHER_COOKIE, { httpOnly: true, sameSite: 'lax', secure: this.teacher.options.secureCookie, path: '/api/teacher' });
  return { authenticated: false };
 }
 @Post('trace') @HttpCode(200) @Header('Cache-Control', 'no-store')
 trace(@Body() body: unknown, @Headers('cookie') cookie: string | undefined, @Headers('origin') origin: string | undefined) {
  return this.teacher.openTrace(body, readCookie(cookie, TEACHER_COOKIE), origin, readCookie(cookie, AUTH_COOKIE_NAME));
 }
}
