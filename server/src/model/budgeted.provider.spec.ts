import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BudgetLedger } from './budget.js';
import { BudgetedModelPort, ProviderCallError, SchemaValidationError } from './budgeted.provider.js';
import { FixtureProvider } from './fixture.provider.js';
import type { ModelPort, ModelRequest, ModelResponse } from './ports.js';
import { RUNTIME_LIMITS } from '../workflows/runtime.js';

const answerSchema = z.strictObject({ text_md: z.string() });

function createLedger(deadlineOffsetMs: number = RUNTIME_LIMITS.workflows.turn.deadline_ms) {
  return new BudgetLedger({
    workflow: 'turn',
    deadlineAt: new Date(Date.now() + deadlineOffsetMs),
  });
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    role: 'diagnosis',
    model: 'fixture-text',
    system: '角色提示',
    input: { task_id: 'self-001' },
    outputSchema: answerSchema,
    maxOutputTokens: 256,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('正常调用', () => {
  it('通过校验后返回已解析数据并记录调用', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'd-1', parsed: { text_md: '你好' } });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    const response = await port.generate(request());

    expect(response.parsed).toEqual({ text_md: '你好' });
    expect(ledger.callsUsed).toBe(1);
  });

  it('reported usage 原样采用且不回退为估计', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', {
      id: 'd-1',
      parsed: { text_md: 'x' },
      usage: { input: 7, output: 3, kind: 'reported' },
    });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    const response = await port.generate(request());

    expect(response.usage).toEqual({ input: 7, output: 3, kind: 'reported' });
    // 结算按实际值，预留的多余额度被退回。
    expect(ledger.remainingOutputTokens).toBe(RUNTIME_LIMITS.workflows.turn.output_tokens_cap - 3);
  });
});

describe('usage 不可信时的保守替换', () => {
  it('unknown usage 被替换为估计输入 + max_output 预留，并标记 estimated', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', {
      id: 'u',
      parsed: { text_md: 'x' },
      behaviour: 'unknown_usage',
    });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    const response = await port.generate(request({ maxOutputTokens: 512 }));

    expect(response.usage.kind).toBe('estimated');
    expect(response.usage.output).toBe(512);
    expect(response.usage.input).toBeGreaterThan(0);
  });

  it('unknown usage 不得按零消耗绕过预算', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', {
      id: 'u',
      parsed: { text_md: 'x' },
      behaviour: 'unknown_usage',
    });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    await port.generate(request({ maxOutputTokens: RUNTIME_LIMITS.workflows.turn.output_tokens_cap }));

    // 预留已被 max_output 占满，第二次调用无法再获得输出额度。
    await expect(port.generate(request({ maxOutputTokens: 1 }))).rejects.toThrowError(/输出 token/);
  });
});

describe('schema 修复', () => {
  it('结构错误时自动修复一次，且修复计入调用数', async () => {
    const provider = new FixtureProvider()
      .enqueue('diagnosis', { id: 'bad', parsed: {}, behaviour: 'malformed' })
      .enqueue('diagnosis', { id: 'good', parsed: { text_md: '修好了' } });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    const response = await port.generate(request());

    expect(response.parsed).toEqual({ text_md: '修好了' });
    expect(provider.roleSequence).toEqual(['diagnosis', 'diagnosis']);
    expect(ledger.callsUsed).toBe(2);
  });

  it('修复请求把校验原因回注 system，并使 input 摘要变化', async () => {
    const provider = new FixtureProvider()
      .enqueue('diagnosis', { id: 'bad', parsed: {}, behaviour: 'malformed' })
      .enqueue('diagnosis', { id: 'good', parsed: { text_md: 'ok' } });
    const port = new BudgetedModelPort(provider, createLedger());

    await port.generate(request());

    const [first, second] = provider.calls;
    expect(second?.systemDigest).not.toBe(first?.systemDigest);
  });

  it('第二次仍不合格时抛 SchemaValidationError', async () => {
    const provider = new FixtureProvider()
      .enqueue('diagnosis', { id: 'bad1', parsed: {}, behaviour: 'malformed' })
      .enqueue('diagnosis', { id: 'bad2', parsed: {}, behaviour: 'malformed' });
    const port = new BudgetedModelPort(provider, createLedger());

    await expect(port.generate(request())).rejects.toBeInstanceOf(SchemaValidationError);
    // 恰好两次：原始调用 + 一次修复，不会无限重试。
    expect(provider.roleSequence).toHaveLength(2);
  });

  it('修复额度是 run 级共享的：一个角色用掉后其他角色不再享有', async () => {
    const provider = new FixtureProvider()
      .enqueue('strategy', { id: 'bad', parsed: {}, behaviour: 'malformed' })
      .enqueue('strategy', { id: 'good', parsed: { text_md: 'ok' } })
      .enqueue('renderer', { id: 'bad2', parsed: {}, behaviour: 'malformed' });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    // Strategy 消耗掉 run 内唯一的修复额度并成功。
    await port.generate(request({ role: 'strategy', input: { step: 1 } }));
    expect(ledger.callsUsed).toBe(2);

    // Renderer 结构不合格时已无额度可用，必须失败而非再次修复。
    await expect(port.generate(request({ role: 'renderer', input: { step: 2 } }))).rejects.toBeInstanceOf(SchemaValidationError);
    expect(provider.roleSequence).toEqual(['strategy', 'strategy', 'renderer']);
  });

  it('无可用修复额度时直接失败，不发起第二次调用', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'bad', parsed: {}, behaviour: 'malformed' });
    const ledger = createLedger();
    ledger.consumeSchemaRepair();
    const port = new BudgetedModelPort(provider, ledger);

    await expect(port.generate(request())).rejects.toMatchObject({ name: 'SchemaValidationError', repairExhausted: true });
    expect(provider.roleSequence).toEqual(['diagnosis']);
  });
});

describe('失败尝试计入预算', () => {
  it('provider 错误包装为 ProviderCallError 且占用调用额度', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'boom', parsed: {}, behaviour: 'error' });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    await expect(port.generate(request())).rejects.toBeInstanceOf(ProviderCallError);
    expect(ledger.callsUsed).toBe(1);
  });

  it('取消同样占用调用额度', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'c', parsed: {}, behaviour: 'cancel' });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    await expect(port.generate(request())).rejects.toBeInstanceOf(ProviderCallError);
    expect(ledger.callsUsed).toBe(1);
  });

  it('累计多次失败后达到上限并拒绝新调用', async () => {
    const provider = new FixtureProvider();
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    for (let index = 0; index < RUNTIME_LIMITS.workflows.turn.max_calls; index += 1) {
      provider.enqueue('diagnosis', { id: `boom-${index}`, parsed: {}, behaviour: 'error' });
      await expect(port.generate(request())).rejects.toBeInstanceOf(ProviderCallError);
    }
    expect(ledger.remainingCalls).toBe(0);
    await expect(port.generate(request())).rejects.toThrowError(/最大调用数/);
  });
});

describe('deadline 与取消', () => {
  it('已过 deadline 时拒绝调用且不触达 provider', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'd-1', parsed: { text_md: 'x' } });
    const port = new BudgetedModelPort(provider, createLedger(-1));

    await expect(port.generate(request())).rejects.toThrowError(/deadline/);
    expect(provider.calls).toEqual([]);
  });

  it('账本取消中止在途调用', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'slow', parsed: { text_md: 'x' }, delayMs: 50 });
    const ledger = createLedger();
    const port = new BudgetedModelPort(provider, ledger);

    const pending = port.generate(request());
    ledger.cancel();
    await expect(pending).rejects.toBeInstanceOf(ProviderCallError);
  });
});

describe('并发上限', () => {
  it('在途调用数不超过 max_concurrent_model_calls', async () => {
    let inFlight = 0;
    let peak = 0;

    const probe: ModelPort = {
      async generate(request_: ModelRequest): Promise<ModelResponse> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return {
          parsed: { text_md: 'ok' },
          usage: { input: 1, output: 1, kind: 'reported' },
          elapsedMs: 1,
          provider: 'probe',
          model: request_.model,
        };
      },
    };

    const ledger = createLedger();
    const port = new BudgetedModelPort(probe, ledger);

    await Promise.all(Array.from({ length: 6 }, (_unused, index) => port.generate(request({ input: { index } }))));

    expect(peak).toBeLessThanOrEqual(RUNTIME_LIMITS.max_concurrent_model_calls);
    expect(peak).toBeGreaterThan(1);
  });
});
