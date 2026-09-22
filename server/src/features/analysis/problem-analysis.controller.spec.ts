import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME } from '../auth/auth.cookie.js';
import type { AuthService } from '../auth/auth.service.js';
import type { BankService } from '../bank/bank.service.js';
import type { QuestionImageLoader } from '../media/question-image-loader.js';
import type { QuestionImageRecognitionService } from '../media/question-image-recognition.service.js';
import type { MediaService } from '../media/media.service.js';
import type { LearningSessionService } from '../learning/learning-session.service.js';
import type { PreparationService } from '../preparation/preparation.service.js';
import { ProblemAnalysisController } from './problem-analysis.controller.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';

function createController() {
  const auth = { authenticate: vi.fn() };
  const analysis = { analyze: vi.fn(), reply: vi.fn() };
  const bank = { getQuestionForAnalysis: vi.fn() };
  const sessions = {
    commitTurn: vi.fn(),
    createSession: vi.fn(),
    failTurn: vi.fn(),
    recordTurnNode: vi.fn(),
    reserveTurn: vi.fn(),
  };
  sessions.createSession.mockResolvedValue({ id: '91', version: 1 });
  const config = {
    get: vi.fn((key: keyof AppEnvironment) =>
      key === 'WEB_ORIGIN'
        ? 'http://localhost:5173'
        : key === 'AI_MODEL'
          ? 'fixture-model'
          : undefined,
    ),
  };
  const imageLoader = { load: vi.fn() };
  const recognition = { recognize: vi.fn() };
  const media = { assertConfirmedTranscript: vi.fn() };
  const preparation = { prepare: vi.fn() };

  return {
    analysis,
    auth,
    bank,
    controller: new ProblemAnalysisController(
      auth as unknown as AuthService,
      bank as unknown as BankService,
      config as unknown as ConfigService<AppEnvironment, true>,
      imageLoader as unknown as QuestionImageLoader,
      recognition as unknown as QuestionImageRecognitionService,
      media as unknown as MediaService,
      preparation as unknown as PreparationService,
      analysis as unknown as ProblemAnalysisService,
      sessions as unknown as LearningSessionService,
    ),
    imageLoader,
    media,
    preparation,
    recognition,
    sessions,
  };
}

describe('ProblemAnalysisController', () => {
  it('authenticates the student and returns a validated analysis request result', async () => {
    const { analysis, auth, controller, sessions } = createController();
    const result = {
      firstQuestion: '你准备先求导还是先观察图像？',
      keyConditions: ['函数为三次多项式'],
      knowledgePoints: ['导数', '单调性'],
      overview: '这是一道利用导数研究函数性质的题目。',
      target: '确定单调区间与极值。',
    };
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    analysis.analyze.mockResolvedValue(result);

    await expect(
      controller.analyzeProblem(
        { problemMd: '  已知函数 $f(x)=x^3-3x$。  ' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toEqual({ analysis: result, session: { id: '91', version: 1 } });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(analysis.analyze).toHaveBeenCalledWith('已知函数 $f(x)=x^3-3x$。');
    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: result,
        ownerId: '7',
        problemMd: '已知函数 $f(x)=x^3-3x$。',
      }),
    );
  });

  it('rejects analysis requests from another origin before calling the model', async () => {
    const { analysis, auth, controller } = createController();

    await expect(
      controller.analyzeProblem(
        { problemMd: '题目' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'https://attacker.example',
      ),
    ).rejects.toMatchObject({ status: 403 });

    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it('loads a selected bank image by question id and analyzes its recognized stem', async () => {
    const { analysis, auth, bank, controller, imageLoader, recognition } = createController();
    const image = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' as const };
    const result = {
      firstQuestion: '补集包含哪些元素？',
      keyConditions: ['$U=[2,5]$', '$A=[2,4)$'],
      knowledgePoints: ['集合', '补集'],
      overview: '这是一道集合补集题。',
      target: '求 $\\overline A$。',
    };
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.getQuestionForAnalysis.mockResolvedValue({
      questionImageUrl: 'https://qisi-main.oss-cn-hangzhou.aliyuncs.com/历年试题/question.png',
      statementMarkdown: null,
    });
    imageLoader.load.mockResolvedValue(image);
    recognition.recognize.mockResolvedValue({
      answerMarkdown: null,
      questionType: '集合题',
      stemMarkdown: '已知全集 $U=[2,5]$，集合 $A=[2,4)$，求 $\\overline A$。',
      uncertain: ['区间右端点是否取到'],
    });
    analysis.analyze.mockResolvedValue(result);

    await expect(
      controller.analyzeProblem(
        { problemMd: '题库图片', questionId: '801' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toEqual({
      analysis: result,
      preparation: { cached: false, status: 'needs_review' },
      problemMd: '已知全集 $U=[2,5]$，集合 $A=[2,4)$，求 $\\overline A$。',
      recognitionUncertain: ['区间右端点是否取到'],
      session: { id: '91', version: 1 },
    });

    expect(bank.getQuestionForAnalysis).toHaveBeenCalledWith('801');
    expect(imageLoader.load).toHaveBeenCalledWith(
      'https://qisi-main.oss-cn-hangzhou.aliyuncs.com/历年试题/question.png',
    );
    expect(recognition.recognize).toHaveBeenCalledWith(image);
    expect(analysis.analyze).toHaveBeenCalledWith(
      '已知全集 $U=[2,5]$，集合 $A=[2,4)$，求 $\\overline A$。',
    );
  });

  it('uses stored bank Markdown without downloading an image and rejects absent questions', async () => {
    const { analysis, auth, bank, controller, imageLoader, recognition } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.getQuestionForAnalysis
      .mockResolvedValueOnce({
        questionImageUrl: null,
        statementMarkdown: '已知集合 $A=\\{1,2\\}$。',
      })
      .mockResolvedValueOnce(undefined);
    analysis.analyze.mockResolvedValue({ overview: '集合题' });

    await expect(
      controller.analyzeProblem(
        { problemMd: '题库题', questionId: '802' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toMatchObject({
      problemMd: '已知集合 $A=\\{1,2\\}$。',
      recognitionUncertain: [],
    });
    expect(imageLoader.load).not.toHaveBeenCalled();
    expect(recognition.recognize).not.toHaveBeenCalled();

    await expect(
      controller.analyzeProblem(
        { problemMd: '题库题', questionId: '999' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('prepares a selected bank question from its private solution image and binds the packet', async () => {
    const {
      analysis,
      auth,
      bank,
      controller,
      imageLoader,
      preparation,
      sessions,
    } = createController();
    const referenceImage = { bytes: new Uint8Array([9, 8, 7]), mime: 'image/png' as const };
    const result = {
      firstQuestion: '先写出定义域。',
      keyConditions: ['$x>0$'],
      knowledgePoints: ['函数', '最值'],
      overview: '这是一道函数最值题。',
      target: '求函数最小值。',
    };
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.getQuestionForAnalysis.mockResolvedValue({
      analysisImageUrl: 'https://qisi-main.oss-cn-hangzhou.aliyuncs.com/历年试题/analysis.png',
      bankVersion: '2024北京卷',
      isOfficial: true,
      questionImageUrl: null,
      source: '2024年高考数学试卷（北京）',
      statementMarkdown: '已知 $f(x)=x+\\frac1x$，$x>0$，求最小值。',
      status: 'ready',
      topicTags: ['函数', '基本不等式'],
    });
    imageLoader.load.mockResolvedValue(referenceImage);
    preparation.prepare.mockResolvedValue({
      cached: false,
      packet: { version: 'a'.repeat(64) },
      status: 'ready',
    });
    analysis.analyze.mockResolvedValue(result);

    await expect(
      controller.analyzeProblem(
        { problemMd: '题库题', questionId: '803' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toMatchObject({
      analysis: result,
      preparation: { cached: false, status: 'ready' },
    });

    expect(imageLoader.load).toHaveBeenCalledWith(
      'https://qisi-main.oss-cn-hangzhou.aliyuncs.com/历年试题/analysis.png',
    );
    expect(preparation.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        problem: expect.objectContaining({
          bank_version: '2024北京卷',
          id: '803',
          is_official: true,
          source: '2024年高考数学试卷（北京）',
          status: 'ready',
          topic_tags: ['函数', '基本不等式'],
        }),
        reference_material_md: expect.stringContaining('原卷解析图片'),
      }),
      expect.objectContaining({
        configHash: 'qisi-3.1-live-bank-solution-image-v1',
        model: 'fixture-model',
        referenceImages: [referenceImage],
      }),
    );
    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ packetVersion: 'a'.repeat(64), questionId: '803' }),
    );
  });

  it('keeps the selected problem and reports a neutral unavailable state when preparation fails', async () => {
    const {
      analysis,
      auth,
      bank,
      controller,
      imageLoader,
      preparation,
      sessions,
    } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.getQuestionForAnalysis.mockResolvedValue({
      analysisImageUrl: 'https://qisi-main.oss-cn-hangzhou.aliyuncs.com/历年试题/analysis.png',
      bankVersion: '2024北京卷',
      isOfficial: true,
      questionImageUrl: null,
      source: '2024年高考数学试卷（北京）',
      statementMarkdown: '已知集合 $A=\\{1,2\\}$。',
      status: 'ready',
      topicTags: ['集合'],
    });
    imageLoader.load.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mime: 'image/png',
    });
    preparation.prepare.mockRejectedValue(new Error('provider unavailable'));
    analysis.analyze.mockResolvedValue({ overview: '集合题' });

    await expect(
      controller.analyzeProblem(
        { problemMd: '题库题', questionId: '804' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toMatchObject({
      preparation: { cached: false, status: 'unavailable' },
      problemMd: '已知集合 $A=\\{1,2\\}$。',
    });
    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ preparationStatus: 'unavailable', questionId: '804' }),
    );
    expect(sessions.createSession.mock.calls[0]?.[0]).not.toHaveProperty('packetVersion');
  });

  it('rejects empty or oversized problems without calling the model', async () => {
    const { analysis, auth, controller } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });

    await expect(
      controller.analyzeProblem(
        { problemMd: '   ' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.analyzeProblem(
        { problemMd: '题'.repeat(12_001) },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it('streams only the checked reply after authenticating the student', async () => {
    const { analysis, auth, controller, media, sessions } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    analysis.reply.mockImplementation(async (_input, _signal, onPhase, onNode) => {
      onPhase?.('guarding');
      await onNode?.({
        finishedAt: '2026-09-19T12:00:01.000Z',
        inputHash: 'ab'.repeat(32),
        modelId: 'fixture-model',
        nodeKey: 'guard',
        output: { verdict: 'accept' },
        promptVersion: 'prompt-v3.0',
        startedAt: '2026-09-19T12:00:00.000Z',
        status: 'completed',
        usage: {
          elapsedMs: 1000,
          input: 20,
          kind: 'reported',
          output: 10,
          provider: 'fixture',
        },
      });
      return {
        audit: {
          decisionIds: ['session-91:conditions'],
          focusGoalKey: 'session-91:method',
          intervention: 'goal_backchain',
          probe: {
            branches: [
              {
                counter_evidence: '能说明导数作用',
                expected: '不会连接符号与单调性',
                hypothesis_id: 'hypothesis-1',
                next_action: '解释符号桥接',
              },
              {
                counter_evidence: '仍不能建立联系',
                expected: '能够独立说明联系',
                hypothesis_id: 'hypothesis-2',
                next_action: '定位概念缺口',
              },
            ],
            goal_key: 'session-91:method',
            question_md: '导函数符号怎样决定原函数单调性？',
          },
          probeGoalKey: 'session-91:method',
          scaffoldLevel: 1,
          wholeTaskDisclosed: false,
        },
        currentVerdict: 'incorrect',
        reply: '先求导，再根据导函数的正负判断单调区间。',
      };
    });
    sessions.reserveTurn.mockResolvedValue({
      analysis: {
        firstQuestion: '先写出导函数。',
        keyConditions: ['函数为三次多项式'],
        knowledgePoints: ['导数', '单调性'],
        overview: '这是一道导数题。',
        target: '确定单调区间。',
      },
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      expectedVersion: 1,
      history: [],
      kind: 'reserved',
      leaseToken: 'lease-token',
      problemMd: '已知函数 $f(x)=x^3-3x$，求单调区间。',
      runId: 'run-id',
      teachingState: {
        exposures: [],
        probesShownByGoal: { 'session-91:method': 1 },
      },
    });
    let committedBeforePublicChunk = false;
    sessions.commitTurn.mockImplementation(async () => {
      committedBeforePublicChunk = true;
      return {
        reply: '先求导，再根据导函数的正负判断单调区间。',
        version: 2,
      };
    });
    const response = {
      destroyed: false,
      end: vi.fn(function (this: { writableEnded: boolean }) {
        this.writableEnded = true;
      }),
      flushHeaders: vi.fn(),
      on: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn(),
      writableEnded: false,
      write: vi.fn((chunk: string) => {
        if (chunk.includes('event: chunk') && !committedBeforePublicChunk) {
          throw new Error('public chunk was written before the checked commit');
        }
      }),
    };
    response.status.mockReturnValue(response);

    await controller.chatProblem(
      {
        assistanceMode: 'finish_problem',
        expectedVersion: 1,
        history: [],
        message: '我先求导。',
        problemMd: '已知函数 $f(x)=x^3-3x$，求单调区间。',
        remediationFocus: 'execution',
        requestId: '11111111-1111-4111-8111-111111111111',
        sessionId: '91',
        transcriptId: '41',
        transcriptRevision: 2,
      },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
      'http://localhost:5173',
      response as unknown as Response,
    );

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(media.assertConfirmedTranscript).toHaveBeenCalledWith('7', '41', 2, '我先求导。');
    expect(analysis.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        assistanceMode: 'finish_problem',
        message: '我先求导。',
        remediationFocus: 'execution',
        teachingState: {
          exposures: [],
          probesShownByGoal: { 'session-91:method': 1 },
        },
      }),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
    );
    expect(analysis.reply.mock.calls[0]?.[0]).not.toHaveProperty('transcriptId');
    expect(sessions.reserveTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: '7',
        remediationFocus: 'execution',
        requestId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(sessions.commitTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.objectContaining({ probeGoalKey: 'session-91:method' }),
        ownerId: '7',
        remediationFocus: 'execution',
        runId: 'run-id',
        sessionId: '91',
        transcriptId: '41',
        transcriptRevision: 2,
      }),
    );
    expect(sessions.recordTurnNode).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseToken: 'lease-token',
        nodeKey: 'guard',
        ownerId: '7',
        runId: 'run-id',
      }),
    );
    const stream = response.write.mock.calls.flat().join('');
    expect(stream).toContain('event: status');
    expect(stream).toContain('正在定位第一处执行偏差');
    expect(stream).toContain('正在检查回复是否符合帮助深度');
    expect(stream).toContain('event: chunk');
    expect(stream).toContain('event: done');
    expect(stream).toContain('"currentVerdict":"incorrect"');
    expect(stream.indexOf('event: chunk')).toBeGreaterThan(stream.indexOf('event: status'));
    expect(response.end).toHaveBeenCalledOnce();
  });
});


function createChatHarness(deadlineMs = 90_000) {
  const harness = createController();
  harness.auth.authenticate.mockResolvedValue({ id: '7' });
  const analysis = {
    firstQuestion: 'fixture question', keyConditions: ['fixture condition'],
    knowledgePoints: ['fixture topic'], overview: 'fixture overview', target: 'fixture target',
  };
  const deadlineAt = new Date(Date.now() + deadlineMs).toISOString();
  harness.sessions.reserveTurn.mockResolvedValue({
    analysis, deadlineAt, expectedVersion: 1, history: [], kind: 'reserved',
    leaseToken: 'fixture-lease', packetVersion: null, problemMd: 'fixture problem',
    runId: 'fixture-run', teachingState: { exposures: [], probesShownByGoal: {} },
  });
  harness.sessions.failTurn.mockResolvedValue(undefined);
  harness.sessions.recordTurnNode.mockResolvedValue(undefined);
  harness.sessions.commitTurn.mockResolvedValue({ version: 2 });
  let close: (() => void) | undefined;
  const response = {
    destroyed: false, writableEnded: false,
    end: vi.fn(function (this: { writableEnded: boolean }) { this.writableEnded = true; }),
    flushHeaders: vi.fn(),
    on: vi.fn((_event: string, callback: () => void) => { close = callback; }),
    setHeader: vi.fn(), status: vi.fn(), write: vi.fn(),
  };
  const invoke = () => harness.controller.chatProblem({
    assistanceMode: 'attempt', expectedVersion: 1, history: [], message: 'fixture attempt',
    problemMd: 'fixture problem', requestId: '11111111-1111-4111-8111-111111111111', sessionId: '91',
  }, `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`, 'http://localhost:5173', response as unknown as Response);
  return { ...harness, deadlineAt, response, invoke, disconnect: () => { response.destroyed = true; close?.(); } };
}

describe('ProblemAnalysisController time budget boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T06:25:23.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('passes only the server reservation deadline to the teaching service', async () => {
    const h = createChatHarness();
    h.analysis.reply.mockResolvedValue({ reply: 'checked' });
    const pending = h.invoke();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(h.analysis.reply.mock.calls[0]![0]).toMatchObject({ deadlineAt: h.deadlineAt });
    expect(h.sessions.commitTurn).toHaveBeenCalledOnce();
  });

  it('sends a safe timeout error on SSE 200 without committing or publishing a candidate', async () => {
    const h = createChatHarness();
    const service = new ProblemAnalysisService({ generate: vi.fn(() => new Promise<never>(() => undefined)) });
    h.analysis.reply.mockImplementation((...args: Parameters<ProblemAnalysisService['reply']>) => service.reply(...args));
    const pending = h.invoke();
    await vi.advanceTimersByTimeAsync(25_000);
    await pending;
    expect(h.response.status).toHaveBeenCalledWith(200);
    expect(h.sessions.failTurn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'MODEL_NODE_TIMEOUT' }));
    const stream = h.response.write.mock.calls.flat().join('');
    expect(stream).toContain('event: error');
    expect(stream).toContain('"code":"MODEL_NODE_TIMEOUT"');
    expect(stream).toContain('超时');
    expect(stream).not.toContain('event: chunk');
    expect(stream).not.toContain('event: done');
    expect(h.sessions.commitTurn).not.toHaveBeenCalled();
    expect(h.response.end).toHaveBeenCalledOnce();
  });

  it('does not commit a reply that resolves after the client has disconnected', async () => {
    const h = createChatHarness();
    let finish!: (value: { reply: string }) => void;
    h.analysis.reply.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = h.invoke();
    await vi.advanceTimersByTimeAsync(1);
    h.disconnect();
    finish({ reply: 'late private candidate' });
    await pending;
    expect(h.sessions.commitTurn).not.toHaveBeenCalled();
    expect(h.sessions.failTurn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'TURN_CANCELLED' }));
    expect(h.response.write.mock.calls.flat().join('')).not.toContain('late private candidate');
  });

  it('rechecks the absolute deadline before committing even if the teaching service returns late', async () => {
    const h = createChatHarness(10_000);
    h.analysis.reply.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 10_001);
      return { reply: 'late private candidate' };
    });
    const pending = h.invoke();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(h.sessions.commitTurn).not.toHaveBeenCalled();
    expect(h.sessions.failTurn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'TURN_DEADLINE_EXCEEDED' }));
    const stream = h.response.write.mock.calls.flat().join('');
    expect(stream).not.toContain('event: chunk');
    expect(stream).toContain('"code":"TURN_DEADLINE_EXCEEDED"');
  });

  it('does not misreport an ordinary provider failure as a timeout or leak its message', async () => {
    const h = createChatHarness();
    h.analysis.reply.mockRejectedValue(new Error('private upstream diagnostic'));
    await h.invoke();
    expect(h.sessions.failTurn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'Error' }));
    const stream = h.response.write.mock.calls.flat().join('');
    expect(stream).not.toContain('private upstream diagnostic');
    expect(stream).not.toContain('MODEL_NODE_TIMEOUT');
    expect(h.sessions.commitTurn).not.toHaveBeenCalled();
  });
});
