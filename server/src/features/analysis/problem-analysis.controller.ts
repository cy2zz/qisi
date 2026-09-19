import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Post,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { BankService } from '../bank/bank.service.js';
import { QuestionImageLoader } from '../media/question-image-loader.js';
import { QuestionImageRecognitionService } from '../media/question-image-recognition.service.js';
import { LearningSessionService } from '../learning/learning-session.service.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';
import { problemChatRequestSchema } from './problem-chat.schema.js';

const requestSchema = z
  .object({
    problemMd: z.string().trim().min(1).max(12_000),
    questionId: z.string().regex(/^[1-9]\d*$/).optional(),
    content: z.string().trim().min(1).max(12_000).optional(),
    title: z.string().trim().min(1).max(255).optional(),
    topic: z.string().trim().max(255).optional(),
  })
  .strict();
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
    @Inject(BankService) private readonly bank: BankService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(QuestionImageLoader) private readonly imageLoader: QuestionImageLoader,
    @Inject(QuestionImageRecognitionService)
    private readonly recognition: QuestionImageRecognitionService,
    @Inject(ProblemAnalysisService) private readonly analysis: ProblemAnalysisService,
    @Inject(LearningSessionService) private readonly sessions: LearningSessionService,
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

    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('problemMd must contain 1–12000 characters');
    }

    if (!parsed.data.questionId) {
      const analysis = await this.analysis.analyze(parsed.data.problemMd);
      const session = await this.sessions.createSession({
        analysis,
        content: parsed.data.content ?? parsed.data.problemMd,
        ownerId: user.id,
        problemMd: parsed.data.problemMd,
        title: parsed.data.title,
        topic: parsed.data.topic,
      });
      return { analysis, session };
    }

    const question = await this.bank.getQuestionForAnalysis(parsed.data.questionId);
    if (!question) throw new NotFoundException('question not found');

    let problemMd = question.statementMarkdown?.trim();
    let recognitionUncertain: string[] = [];
    if (!problemMd) {
      if (!question.questionImageUrl) {
        throw new UnprocessableEntityException('question has no readable content');
      }
      const image = await this.imageLoader.load(question.questionImageUrl);
      const recognition = await this.recognition.recognize(image);
      problemMd = recognition.stemMarkdown;
      recognitionUncertain = recognition.uncertain;
    }

    const analysis = await this.analysis.analyze(problemMd);
    const session = await this.sessions.createSession({
      analysis,
      content: parsed.data.content ?? parsed.data.problemMd,
      ownerId: user.id,
      problemMd,
      questionId: parsed.data.questionId,
      recognitionUncertain,
      title: parsed.data.title,
      topic: parsed.data.topic,
    });

    return {
      analysis,
      problemMd,
      recognitionUncertain,
      session,
    };
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

    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const parsed = problemChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('invalid problem chat request');
    }

    const reservation = await this.sessions.reserveTurn({
      assistanceMode: parsed.data.assistanceMode,
      expectedVersion: parsed.data.expectedVersion,
      message: parsed.data.message,
      ownerId: user.id,
      requestId: parsed.data.requestId,
      sessionId: parsed.data.sessionId,
    });

    response.status(200);
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    if (reservation.kind === 'replay') {
      for (const text of splitReply(reservation.reply)) {
        writeStreamEvent(response, 'chunk', { text });
      }
      writeStreamEvent(response, 'done', { version: reservation.version });
      response.end();
      return;
    }

    const abortController = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) abortController.abort();
    });
    writeStreamEvent(response, 'status', { message: '正在核对你的这一步' });

    try {
      const result = await this.analysis.reply(
        {
          ...parsed.data,
          analysis: reservation.analysis,
          history: reservation.history,
          problemMd: reservation.problemMd,
          teachingState: reservation.teachingState,
        },
        abortController.signal,
        (phase) => {
          if (!response.destroyed && !response.writableEnded) {
            const phaseMessage = {
              diagnosing: '正在核对你这一步的依据',
              'reviewing-route': '正在核对你提出的不同解法',
              planning: '正在选择下一项最小帮助',
              rendering: '正在整理本轮反馈',
              guarding: '正在检查回复是否符合帮助深度',
            }[phase];
            writeStreamEvent(response, 'status', {
              message: phaseMessage,
            });
          }
        },
        (record) => this.sessions.recordTurnNode({
          ...record,
          leaseToken: reservation.leaseToken,
          ownerId: user.id,
          runId: reservation.runId,
        }),
      );
      const committed = await this.sessions.commitTurn({
        assistanceMode: parsed.data.assistanceMode,
        audit: result.audit,
        currentVerdict: result.currentVerdict,
        expectedVersion: reservation.expectedVersion,
        leaseToken: reservation.leaseToken,
        message: parsed.data.message,
        ownerId: user.id,
        reply: result.reply,
        requestId: parsed.data.requestId,
        runId: reservation.runId,
        sessionId: parsed.data.sessionId,
      });
      for (const text of splitReply(result.reply)) {
        if (response.destroyed || response.writableEnded) return;
        writeStreamEvent(response, 'chunk', { text });
        await waitForStreamFrame();
      }
      writeStreamEvent(response, 'done', { version: committed.version });
    } catch (error) {
      await this.sessions.failTurn({
        errorCode: error instanceof Error ? error.name : 'UnknownError',
        leaseToken: reservation.leaseToken,
        ownerId: user.id,
        requestId: parsed.data.requestId,
        runId: reservation.runId,
        sessionId: parsed.data.sessionId,
      }).catch(() => undefined);
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
