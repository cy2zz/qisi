import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BudgetLedger } from '../../src/model/budget.js';
import { BudgetedModelPort, ProviderCallError } from '../../src/model/budgeted.provider.js';
import type { ModelRequest, ModelResponse } from '../../src/model/ports.js';
const ledger = () => new BudgetLedger({ workflow: 'turn', deadlineAt: new Date(Date.now() + 1000) });
const response: ModelResponse = { parsed: { ok: true }, usage: { input: 1, output: 1, kind: 'reported' }, provider: 'test', model: 'test', elapsedMs: 1 };
const request = (signal: AbortSignal): ModelRequest => ({ role: 'guard', model: 'test', system: 'bounded', input: {}, outputSchema: z.object({ ok: z.boolean() }), maxOutputTokens: 10, signal });
afterEach(() => vi.useRealTimers());
describe('B07/B01 budget safety regression', () => {
 it.each([-1, NaN, 0.2])('rejects invalid token accounting %s', n => {
  const budget = ledger(); expect(() => budget.authorizeCall({ inputTokens: n, outputTokens: 1 })).toThrow(); expect(budget.callsUsed).toBe(0);
 });
 it('cannot settle the same reservation twice and refund consumed tokens', () => {
  const budget = ledger(); const reserved = budget.authorizeCall({ inputTokens: 20, outputTokens: 20 }); budget.settle(reserved, { inputTokens: 10, outputTokens: 10 });
  expect(() => budget.settle(reserved, { inputTokens: 0, outputTokens: 0 })).toThrow();
 });
 it('rejects an actual token overrun before candidate use', () => {
  const budget = ledger(); const reserved = budget.authorizeCall({ inputTokens: 1, outputTokens: 1 });
  expect(() => budget.settle(reserved, { inputTokens: 1, outputTokens: budget.workflowBudgetLimits.output_tokens_cap + 1 })).toThrow();
 });
 it('cancellation rejects a provider that ignores AbortSignal', async () => {
  const controller = new AbortController(); let resolve!: (value: ModelResponse) => void;
  const pending = new Promise<ModelResponse>(r => { resolve = r; }); const budget = ledger();
  const port = new BudgetedModelPort({ generate: () => pending }, budget);
  const result = port.generate(request(controller.signal)); await Promise.resolve(); await Promise.resolve(); controller.abort(); resolve(response);
  await expect(result).rejects.toThrow(); expect(budget.callsUsed).toBe(1);
 });
 it('hard deadline rejects a hanging provider, not only the next call', async () => {
  vi.useFakeTimers(); const budget = ledger(); const port = new BudgetedModelPort({ generate: () => new Promise(() => {}) }, budget);
  let status = 'pending'; const observed = port.generate(request(new AbortController().signal)).then(() => { status = 'succeeded'; }, () => { status = 'rejected'; });
  await vi.advanceTimersByTimeAsync(1100); expect(status).toBe('rejected'); await observed;
 });
 it('does not echo provider errors that may include student input or credentials', () => {
  expect(new ProviderCallError('guard', new Error('PRIVATE_KEY_AND_STUDENT_TEXT')).message).not.toContain('PRIVATE_');
 });
});
