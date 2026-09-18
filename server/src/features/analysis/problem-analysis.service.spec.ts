import { describe, expect, it, vi } from 'vitest';
import type { ModelPort } from '../../model/model.port.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';

const validAnalysis = {
  firstQuestion: '你准备先求导还是先观察图像？',
  keyConditions: ['函数为三次多项式'],
  knowledgePoints: ['导数', '单调性'],
  overview: '这是一道利用导数研究函数性质的题目。',
  target: '确定单调区间与极值。',
};

describe('ProblemAnalysisService', () => {
  it('uses the preparation role and validates the structured analysis', async () => {
    const model = {
      generate: vi.fn().mockResolvedValue({ parsed: validAnalysis }),
    };
    const service = new ProblemAnalysisService(model as unknown as ModelPort);

    await expect(service.analyze('已知函数 $f(x)=x^3-3x$。')).resolves.toEqual(validAnalysis);
    expect(model.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: '已知函数 $f(x)=x^3-3x$。',
        maxOutputTokens: 1000,
        role: 'preparation',
      }),
    );
  });

  it('rejects malformed provider output instead of projecting it to the student', async () => {
    const model = {
      generate: vi.fn().mockResolvedValue({ parsed: { overview: 'missing fields' } }),
    };
    const service = new ProblemAnalysisService(model as unknown as ModelPort);

    await expect(service.analyze('题目')).rejects.toMatchObject({ status: 502 });
  });

  it('answers one student turn with the visible conversation context', async () => {
    const model = {
      generate: vi.fn().mockResolvedValue({
        parsed: { reply: '先求出 $f\'(x)$，再看它在哪些区间取正或取负。' },
      }),
    };
    const service = new ProblemAnalysisService(model as unknown as ModelPort);

    await expect(
      service.reply({
        history: [
          { content: '我准备先求导。', role: 'student' },
          { content: '可以，先写出导函数。', role: 'guide' },
        ],
        message: '然后怎么判断单调区间？',
        problemMd: '已知函数 $f(x)=x^3-3x$，求单调区间与极值。',
      }),
    ).resolves.toEqual({ reply: '先求出 $f\'(x)$，再看它在哪些区间取正或取负。' });

    expect(model.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('然后怎么判断单调区间？'),
        role: 'strategy',
      }),
    );
    const request = model.generate.mock.calls[0]![0] as { input: string };
    expect(JSON.parse(request.input)).toMatchObject({
      conversation: [
        { content: '我准备先求导。', role: 'student' },
        { content: '可以，先写出导函数。', role: 'guide' },
      ],
      currentStudentMessage: '然后怎么判断单调区间？',
    });
  });
});
