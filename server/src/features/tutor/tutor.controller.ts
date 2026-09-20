// 教学轮 HTTP 入口。
//
// 契约来源 server-functions.json：submitTurn / input=TurnInput / output=StudentView。
//
// 副作用函数的强制检查（contracts/README.md §2）：
//   「所有有副作用函数检查Origin、身份、归属、schema、request_id和expected_version。」
// 四项在此逐条落地：Origin 比对、owner cookie 鉴权、Zod 严格解析（含 request_id 与
// expected_version 必填）、归属由会话查询保证。
//
// 不向客户端流式发送任何未校验内容（runtime.json: public_output_streaming=false）：
// 本端点是一次性 JSON 响应，响应体是已提交后的 StudentView 投影。

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../../config/env.js';
import { TurnInputSchema, StudentViewSchema } from '../../contracts/domain.schema.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { TutorService } from './tutor.service.js';

@Controller('tutor')
export class TutorController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(TutorService) private readonly tutor: TutorService,
  ) {}

  @Post('turn')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async submitTurn(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    // Origin 先行：来源不合法的请求不应触达鉴权与会话查询，避免产生额外副作用与日志噪声。
    if (origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('origin is not allowed');
    }

    const owner = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    if (!owner) {
      throw new ForbiddenException('authentication required');
    }

    const parsed = TurnInputSchema.safeParse(body);
    if (!parsed.success) {
      // 不回显字段级错误细节：它们可能泄露私有 Schema 结构。
      throw new BadRequestException('invalid turn request');
    }

    try {
      const view = await this.tutor.submitTurn(parsed.data);
      // 投影结果再次过一遍契约：投影是白名单构造，此处防的是实现改动引入的字段漂移。
      return StudentViewSchema.parse(view);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw error;
    }
  }
}
