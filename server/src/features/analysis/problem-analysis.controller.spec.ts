import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME } from '../auth/auth.cookie.js';
import type { AuthService } from '../auth/auth.service.js';
import { ProblemAnalysisController } from './problem-analysis.controller.js';
import type { ProblemAnalysisService } from './problem-analysis.service.js';

function createController() {
  const auth = { authenticate: vi.fn() };
  const analysis = { analyze: vi.fn(), reply: vi.fn() };
  const config = {
    get: vi.fn((key: keyof AppEnvironment) =>
      key === 'WEB_ORIGIN' ? 'http://localhost:5173' : undefined,
    ),
  };

  return {
    analysis,
    auth,
    controller: new ProblemAnalysisController(
      auth as unknown as AuthService,
      config as unknown as ConfigService<AppEnvironment, true>,
      analysis as unknown as ProblemAnalysisService,
    ),
  };
}

describe('ProblemAnalysisController', () => {
  it('authenticates the student and returns a validated analysis request result', async () => {
    const { analysis, auth, controller } = createController();
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
    ).resolves.toEqual({ analysis: result });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(analysis.analyze).toHaveBeenCalledWith('已知函数 $f(x)=x^3-3x$。');
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
    const { analysis, auth, controller } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    analysis.reply.mockResolvedValue({ reply: '先求导，再根据导函数的正负判断单调区间。' });
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
      write: vi.fn(),
    };
    response.status.mockReturnValue(response);

    await controller.chatProblem(
      {
        history: [],
        message: '我先求导。',
        problemMd: '已知函数 $f(x)=x^3-3x$，求单调区间。',
      },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
      'http://localhost:5173',
      response as unknown as Response,
    );

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(analysis.reply).toHaveBeenCalledWith(
      expect.objectContaining({ message: '我先求导。' }),
      expect.any(AbortSignal),
    );
    const stream = response.write.mock.calls.flat().join('');
    expect(stream).toContain('event: status');
    expect(stream).toContain('event: chunk');
    expect(stream).toContain('event: done');
    expect(stream.indexOf('event: chunk')).toBeGreaterThan(stream.indexOf('event: status'));
    expect(response.end).toHaveBeenCalledOnce();
  });
});
