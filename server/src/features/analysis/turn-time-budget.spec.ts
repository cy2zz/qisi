import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ModelPort } from '../../model/model.port.js';
import { TurnTimeBudget } from './turn-time-budget.js';

const request = { input: 'fixture', system: 'fixture', model: 'fixture', role: 'guard' as const,
  outputSchema: z.unknown(), maxOutputTokens: 100, signal: new AbortController().signal };
function provider(usage = { input: 1, output: 1, kind: 'reported' as 'reported' | 'unknown' }) {
  return { generate: vi.fn(async () => ({ parsed: {}, model: 'fixture', provider: 'fixture', elapsedMs: 1, usage })) };
}
describe('chat shared call/token budget', () => {
  it('rejects the eighth attempt before reaching the provider', async () => {
    const budget = new TurnTimeBudget(undefined, request.signal);
    const model = provider();
    try {
      for (let i = 0; i < 7; i++) await budget.generate(model, request);
      await expect(budget.generate(model, request)).rejects.toMatchObject({ code: 'CALLS_EXHAUSTED' });
      expect(model.generate).toHaveBeenCalledTimes(7);
    } finally { budget.dispose(); }
  });
  it('counts failed attempts instead of refunding them', async () => {
    const budget = new TurnTimeBudget(undefined, request.signal);
    const model: ModelPort = { generate: vi.fn().mockRejectedValue(new Error('fixture failure')) };
    try {
      for (let i = 0; i < 7; i++) await expect(budget.generate(model, request)).rejects.toThrow('fixture failure');
      await expect(budget.generate(model, request)).rejects.toMatchObject({ code: 'CALLS_EXHAUSTED' });
      expect(model.generate).toHaveBeenCalledTimes(7);
    } finally { budget.dispose(); }
  });
  it('reserves max output for unknown usage rather than using zero', async () => {
    const budget = new TurnTimeBudget(undefined, request.signal);
    const model = provider({ input: 0, output: 0, kind: 'unknown' });
    try {
      for (let i = 0; i < 4; i++) {
        const result = await budget.generate(model, { ...request, maxOutputTokens: 2000 });
        expect(result.usage).toMatchObject({ kind: 'estimated', output: 2000 });
      }
      await expect(budget.generate(model, request)).rejects.toMatchObject({ code: 'OUTPUT_TOKENS_EXCEEDED' });
      expect(model.generate).toHaveBeenCalledTimes(4);
    } finally { budget.dispose(); }
  });
  it('refuses oversized input before calling the provider', async () => {
    const budget = new TurnTimeBudget(undefined, request.signal);
    const model = provider();
    try {
      await expect(budget.generate(model, { ...request, input: '字'.repeat(24001) })).rejects.toMatchObject({ code: 'INPUT_TOKENS_EXCEEDED' });
      expect(model.generate).not.toHaveBeenCalled();
    } finally { budget.dispose(); }
  });
});
