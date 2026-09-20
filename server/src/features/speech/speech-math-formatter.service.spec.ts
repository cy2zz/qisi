import { describe, expect, it, vi } from 'vitest';
import type { ModelPort } from '../../model/model.port.js';
import { SpeechMathFormatterService } from './speech-math-formatter.service.js';

function createService(parsed: unknown = { markdown: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？' }) {
  const model: ModelPort = {
    generate: vi.fn().mockResolvedValue({
      elapsedMs: 10,
      model: 'test-model',
      parsed,
      provider: 'fixture',
      usage: { input: 10, kind: 'estimated', output: 5 },
    }),
  };
  return { model, service: new SpeechMathFormatterService(model) };
}

describe('SpeechMathFormatterService', () => {
  it('converts spoken mathematics into a LaTeX draft without solving it', async () => {
    const { model, service } = createService();

    await expect(service.format('根号2除以根号3等于多少？')).resolves.toEqual({
      formatted: true,
      markdown: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
    });

    expect(model.generate).toHaveBeenCalledWith(expect.objectContaining({
      input: '根号2除以根号3等于多少？',
      maxOutputTokens: 800,
      role: 'renderer',
      system: expect.stringContaining('不要计算、求解或补充答案'),
    }));
  });

  it('falls back to the original transcript when formatting fails', async () => {
    const { model, service } = createService();
    vi.mocked(model.generate).mockRejectedValue(new Error('provider unavailable'));

    await expect(service.format('根号2除以根号3等于多少？')).resolves.toEqual({
      formatted: false,
      markdown: '根号2除以根号3等于多少？',
    });
  });

  it('falls back when the model returns an invalid draft', async () => {
    const { service } = createService({ markdown: '' });

    await expect(service.format('x的平方')).resolves.toEqual({
      formatted: false,
      markdown: 'x的平方',
    });
  });

  it('does not call the model for an empty recognition result', async () => {
    const { model, service } = createService();

    await expect(service.format('')).resolves.toEqual({
      formatted: false,
      markdown: '',
    });
    expect(model.generate).not.toHaveBeenCalled();
  });
});
