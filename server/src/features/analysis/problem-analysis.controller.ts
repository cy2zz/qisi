import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import type { AppEnvironment } from '../../config/env.js';
import { isAllowedWebOrigin } from '../../config/web-origin.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { BankService } from '../bank/bank.service.js';
import { QuestionImageLoader } from '../media/question-image-loader.js';
import { QuestionImageRecognitionService } from '../media/question-image-recognition.service.js';
import { MediaService } from '../media/media.service.js';
import { LearningSessionService } from '../learning/learning-session.service.js';
import { PreparationService } from '../preparation/preparation.service.js';
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
const LIVE_BANK_PREPARATION_CONFIG = 'qisi-3.1-live-bank-solution-image-v1';

function problemContentHash(problemMd: string) {
  return createHash('sha256').update(problemMd).digest('hex');
}

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
  private readonly logger = new Logger(ProblemAnalysisController.name);

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BankService) private readonly bank: BankService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(QuestionImageLoader) private readonly imageLoader: QuestionImageLoader,
    @Inject(QuestionImageRecognitionService)
    private readonly recognition: QuestionImageRecognitionService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(PreparationService) private readonly preparation: PreparationService,
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
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
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

    const questionId = parsed.data.questionId;
    const question = await this.bank.getQuestionForAnalysis(questionId);
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

    const preparationPromise = question.analysisImageUrl
      ? this.imageLoader.load(question.analysisImageUrl)
          .then((referenceImage) => this.preparation.prepare({
            evidence_refs: [],
            mode: 'prepare',
            problem: {
              asset_ids: [`question:${questionId}`, `analysis:${questionId}`],
              bank_version: question.bankVersion,
              content_hash: problemContentHash(problemMd),
              id: questionId,
              is_official: question.isOfficial,
              issues: recognitionUncertain,
              source: question.source,
              statement_md: problemMd,
              status: question.status === 'ready' && recognitionUncertain.length === 0
                ? 'ready'
                : 'needs_review',
              topic_tags: question.topicTags,
            },
            reference_material_md: `原卷解析图片（仅供服务端核对）：${question.analysisImageUrl}`,
            student_route_md: null,
          }, {
            configHash: LIVE_BANK_PREPARATION_CONFIG,
            model: this.config.get('AI_MODEL', { infer: true }),
            referenceImages: [referenceImage],
          }))
          .then((prepared) => ({ kind: 'prepared' as const, prepared }))
          .catch((error: unknown) => {
            this.logger.warn(
              `Bank preparation unavailable for question ${questionId}: ${error instanceof Error ? error.name : 'UnknownError'}`,
            );
            return { kind: 'unavailable' as const };
          })
      : Promise.resolve({ kind: 'missing_reference' as const });
    const [analysis, preparationOutcome] = await Promise.all([
      this.analysis.analyze(problemMd),
      preparationPromise,
    ]);
    const prepared = preparationOutcome.kind === 'prepared'
      ? preparationOutcome.prepared
      : null;
    const preparationStatus = prepared?.status
      ?? (preparationOutcome.kind === 'unavailable' ? 'unavailable' : 'needs_review');
    const session = await this.sessions.createSession({
      analysis,
      content: parsed.data.content ?? parsed.data.problemMd,
      ownerId: user.id,
      ...(prepared ? { packetVersion: prepared.packet.version } : {}),
      preparationStatus,
      problemMd,
      questionId,
      recognitionUncertain,
      title: parsed.data.title,
      topic: parsed.data.topic,
    });

    return {
      analysis,
      preparation: {
        cached: prepared?.cached ?? false,
        status: preparationStatus,
      },
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
    if (!isAllowedWebOrigin(origin, this.config.get('WEB_ORIGIN', { infer: true }))) {
      throw new ForbiddenException('origin is not allowed');
    }

    const user = await this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
    const parsed = problemChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('invalid problem chat request');
    }
    if (parsed.data.transcriptId && parsed.data.transcriptRevision) {
      await this.media.assertConfirmedTranscript(
        user.id,
        parsed.data.transcriptId,
        parsed.data.transcriptRevision,
        parsed.data.message,
      );
    }

    const reservation = await this.sessions.reserveTurn({
      assistanceMode: parsed.data.assistanceMode,
      expectedVersion: parsed.data.expectedVersion,
      message: parsed.data.message,
      ownerId: user.id,
      remediationFocus: parsed.data.remediationFocus,
      requestId: parsed.data.requestId,
      sessionId: parsed.data.sessionId,
      transcriptId: parsed.data.transcriptId,
      transcriptRevision: parsed.data.transcriptRevision,
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
      writeStreamEvent(response, 'done', {
        ...(reservation.currentVerdict
          ? { currentVerdict: reservation.currentVerdict }
          : {}),
        version: reservation.version,
      });
      response.end();
      return;
    }

    const abortController = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) abortController.abort();
    });
    const remediationStatus = parsed.data.remediationFocus
      ? {
          evidence: '正在核对这次独立证据的边界',
          execution: '正在定位第一处执行偏差',
          method: '正在核对方法选择与依据',
        }[parsed.data.remediationFocus]
      : '正在核对你的这一步';
    writeStreamEvent(response, 'status', { message: remediationStatus });

    try {
      const safeModelRequest = { ...parsed.data };
      delete safeModelRequest.transcriptId;
      delete safeModelRequest.transcriptRevision;
      const result = await this.analysis.reply(
        {
          ...safeModelRequest,
          analysis: reservation.analysis,
          history: reservation.history,
          packetVersion: reservation.packetVersion,
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
        remediationFocus: parsed.data.remediationFocus,
        reply: result.reply,
        requestId: parsed.data.requestId,
        runId: reservation.runId,
        sessionId: parsed.data.sessionId,
        transcriptId: parsed.data.transcriptId,
        transcriptRevision: parsed.data.transcriptRevision,
      });
      for (const text of splitReply(result.reply)) {
        if (response.destroyed || response.writableEnded) return;
        writeStreamEvent(response, 'chunk', { text });
        await waitForStreamFrame();
      }
      writeStreamEvent(response, 'done', {
        ...(result.currentVerdict ? { currentVerdict: result.currentVerdict } : {}),
        version: committed.version,
      });
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
