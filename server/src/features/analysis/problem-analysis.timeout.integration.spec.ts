import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service.js';
import { BankService } from '../bank/bank.service.js';
import { LearningSessionService } from '../learning/learning-session.service.js';
import { MediaService } from '../media/media.service.js';
import { QuestionImageLoader } from '../media/question-image-loader.js';
import { QuestionImageRecognitionService } from '../media/question-image-recognition.service.js';
import { PreparationService } from '../preparation/preparation.service.js';
import { ProblemAnalysisController } from './problem-analysis.controller.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';

const body = {
  assistanceMode: 'attempt', expectedVersion: 1, history: [], message: 'fixture attempt',
  problemMd: 'fixture problem', requestId: '11111111-1111-4111-8111-111111111111', sessionId: '91',
};

async function createHttpHarness(mode: 'timeout' | 'success' | 'replay') {
  const sessions = {
    reserveTurn: vi.fn(async () => mode === 'replay' ? {
      kind: 'replay', reply: 'checked replay', version: 2,
    } : {
      kind: 'reserved', deadlineAt: new Date(Date.now() + (mode === 'timeout' ? 1_150 : 90_000)).toISOString(),
      expectedVersion: 1, history: [], leaseToken: 'fixture-lease', packetVersion: null,
      problemMd: 'fixture problem', runId: 'fixture-run',
      analysis: { firstQuestion: 'fixture question', keyConditions: ['fixture condition'],
        knowledgePoints: ['fixture topic'], overview: 'fixture overview', target: 'fixture target' },
      teachingState: { exposures: [], probesShownByGoal: {} },
    }),
    recordTurnNode: vi.fn().mockResolvedValue(undefined),
    commitTurn: vi.fn().mockResolvedValue({ version: 2 }),
    failTurn: vi.fn().mockResolvedValue(undefined),
  };
  const model = { generate: vi.fn(() => new Promise<never>(() => undefined)) };
  const analysis = mode === 'timeout' ? new ProblemAnalysisService(model)
    : { reply: vi.fn().mockResolvedValue({ reply: 'checked reply' }) };
  const module = await Test.createTestingModule({
    controllers: [ProblemAnalysisController],
    providers: [
      { provide: AuthService, useValue: { authenticate: vi.fn().mockResolvedValue({ id: '7' }) } },
      { provide: BankService, useValue: {} },
      { provide: ConfigService, useValue: { get: () => 'http://localhost:5173' } },
      { provide: QuestionImageLoader, useValue: {} },
      { provide: QuestionImageRecognitionService, useValue: {} },
      { provide: MediaService, useValue: {} },
      { provide: PreparationService, useValue: {} },
      { provide: ProblemAnalysisService, useValue: analysis },
      { provide: LearningSessionService, useValue: sessions },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  return { app, sessions, model };
}

describe('POST /api/problems/chat SSE time budget integration (fixture)', () => {
  it('ends an HTTP 200 event stream with an explicit deadline error and no answer', async () => {
    const { app, sessions, model } = await createHttpHarness('timeout');
    try {
      const response = await request(app.getHttpServer()).post('/api/problems/chat')
        .set('Origin', 'http://localhost:5173').send(body).expect(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.text).toContain('event: status');
      expect(response.text).toContain('event: error');
      expect(response.text).toContain('"code":"TURN_DEADLINE_EXCEEDED"');
      expect(response.text).toContain('时间上限');
      expect(response.text).not.toContain('event: chunk');
      expect(response.text).not.toContain('event: done');
      expect(model.generate).toHaveBeenCalledOnce();
      expect(sessions.commitTurn).not.toHaveBeenCalled();
      expect(sessions.failTurn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'TURN_DEADLINE_EXCEEDED' }));
    } finally { await app.close(); }
  });

  it.each(['success', 'replay'] as const)('preserves checked %s chunk/done responses', async (mode) => {
    const { app, sessions, model } = await createHttpHarness(mode);
    try {
      const response = await request(app.getHttpServer()).post('/api/problems/chat')
        .set('Origin', 'http://localhost:5173').send(body).expect(200);
      expect(response.text).toContain('event: chunk');
      expect(response.text).toContain('event: done');
      expect(response.text).toContain('"version":2');
      expect(response.text).not.toContain('event: error');
      expect(sessions.failTurn).not.toHaveBeenCalled();
      expect(sessions.commitTurn).toHaveBeenCalledTimes(mode === 'success' ? 1 : 0);
      expect(model.generate).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
