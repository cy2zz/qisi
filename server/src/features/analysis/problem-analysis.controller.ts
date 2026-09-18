import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';
import { problemChatRequestSchema } from './problem-chat.schema.js';

const requestSchema = z.object({ problemMd: z.string().trim().min(1).max(12_000) }).strict();
const STREAM_CHUNK_SIZE = 8;
const STREAM_CHUNK_DELAY_MS = 18;

function writeStreamEvent(response: Response, event: string, data: object) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function splitReply(reply: string) {
  const characters = Array.from(reply);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += STREAM_CHUNK_SIZE) {
    chunks.push(characters.slice(index, index + STREAM_CHUNK_SIZE).join(''));
  }
  return chunks;
}

function waitForStreamFrame() {
  return new Promise<void>((resolve) => setTimeout(resolve, STREAM_CHUNK_DELAY_MS));
}

@Controller('problems')
export class ProblemAnalysisController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(ProblemAnalysisService) private readonly analysis: ProblemAnalysisService,
  ) {}

  @Post('analyze')
  @Header('Cache-Control', 'no-store')
  async analyzeProblem(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
  ) {
    if (origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('origin is not allowed');
    }

    await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('problemMd must contain 1–12000 characters');
    }

    return { analysis: await this.analysis.analyze(parsed.data.problemMd) };
  }

  @Post('chat')
  async chatProblem(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res() response: Response,
  ) {
    if (origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new ForbiddenException('origin is not allowed');
    }

    await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const parsed = problemChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('invalid problem chat request');
    }

    response.status(200);
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const abortController = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) abortController.abort();
    });
    writeStreamEvent(response, 'status', { message: '正在核对你的这一步' });

    try {
      const result = await this.analysis.reply(parsed.data, abortController.signal);
      for (const text of splitReply(result.reply)) {
        if (response.destroyed || response.writableEnded) return;
        writeStreamEvent(response, 'chunk', { text });
        await waitForStreamFrame();
      }
      writeStreamEvent(response, 'done', {});
    } catch {
      if (!response.destroyed && !response.writableEnded) {
        writeStreamEvent(response, 'error', {
          message: '暂时无法回应这一步。你的内容已经保留，可以重试。',
        });
      }
    } finally {
      if (!response.writableEnded) response.end();
    }
  }
}
