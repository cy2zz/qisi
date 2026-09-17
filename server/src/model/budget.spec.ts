import { describe, expect, it } from 'vitest';
import { BudgetExceededError, BudgetLedger, type BudgetCallAccounting } from './budget.js';
import { RUNTIME_LIMITS } from '../workflows/runtime.js';

// 注入时钟，使 deadline 行为可确定性验证（不依赖真实等待）。
function createClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (deltaMs: number) => {
      current += deltaMs;
    },
  };
}

const start = Date.UTC(2026, 8, 17, 0, 0, 0);

function createLedger(options: { workflow?: 'turn' | 'prepare'; deadlineMs?: number; clock?: ReturnType<typeof createClock> } = {}) {
  const clock = options.clock ?? createClock(start);
  const ledger = new BudgetLedger({
    workflow: options.workflow ?? 'turn',
    deadlineAt: new Date(start + (options.deadlineMs ?? RUNTIME_LIMITS.workflows.turn.deadline_ms)),
    now: clock.now,
  });
  return { ledger, clock };
}

const smallCall: BudgetCallAccounting = { inputTokens: 10, outputTokens: 10 };

/** 一次完整调用：授权（预留）+ 按相同用量结算。 */
function completeCall(ledger: BudgetLedger, accounting: BudgetCallAccounting = smallCall): void {
  const reservation = ledger.authorizeCall(accounting);
  ledger.settle(reservation, accounting);
}

describe('调用数上限', () => {
  it('授权后即可见调用数已占用', () => {
    const { ledger } = createLedger();
    ledger.authorizeCall(smallCall);
    // 预留即计入：这是并发下不突破上限的前提。
    expect(ledger.callsUsed).toBe(1);
  });

  it('完成一次调用后可继续授权', () => {
    const { ledger } = createLedger();
    completeCall(ledger);
    expect(ledger.callsUsed).toBe(1);
    expect(ledger.remainingCalls).toBe(RUNTIME_LIMITS.workflows.turn.max_calls - 1);
  });

  it('达到 max_calls 后拒绝新调用', () => {
    const { ledger } = createLedger();
    const max = RUNTIME_LIMITS.workflows.turn.max_calls;
    for (let index = 0; index < max; index += 1) completeCall(ledger);
    expect(() => ledger.authorizeCall(smallCall)).toThrowError(BudgetExceededError);
    expect(ledger.callsUsed).toBe(max);
  });

  it('未结算的预留同样占用额度——失败与在途调用不得被重复计入', () => {
    const { ledger } = createLedger();
    const max = RUNTIME_LIMITS.workflows.turn.max_calls;
    // 模拟全部调用失败：只授权、不结算。
    for (let index = 0; index < max; index += 1) ledger.authorizeCall(smallCall);
    expect(ledger.remainingCalls).toBe(0);
    expect(() => ledger.authorizeCall(smallCall)).toThrowError(/最大调用数/);
  });

  it('并发授权不会挤过同一份额度', () => {
    const { ledger } = createLedger();
    const max = RUNTIME_LIMITS.workflows.turn.max_calls;
    // 同时发起 max+2 个调用且都不结算，只有 max 个能获得授权。
    const granted = Array.from({ length: max + 2 }, () => {
      try {
        ledger.authorizeCall(smallCall);
        return true;
      } catch {
        return false;
      }
    });
    expect(granted.filter(Boolean)).toHaveLength(max);
    expect(ledger.callsUsed).toBe(max);
  });
});

describe('deadline', () => {
  it('未超时授权通过', () => {
    const { ledger, clock } = createLedger();
    clock.advance(RUNTIME_LIMITS.workflows.turn.deadline_ms - 1);
    expect(() => ledger.authorizeCall(smallCall)).not.toThrow();
  });

  it('到达 deadline 即拒绝，即使调用额度尚有余量', () => {
    const { ledger, clock } = createLedger();
    clock.advance(RUNTIME_LIMITS.workflows.turn.deadline_ms);
    expect(ledger.remainingCalls).toBeGreaterThan(0);
    expect(() => ledger.authorizeCall(smallCall)).toThrowError(/deadline/);
  });

  it('队列等待计入 deadline', () => {
    const { ledger, clock } = createLedger();
    clock.advance(RUNTIME_LIMITS.workflows.turn.deadline_ms + 5_000);
    try {
      ledger.authorizeCall(smallCall);
      throw new Error('应当抛出 BudgetExceededError');
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      expect((error as BudgetExceededError).code).toBe('DEADLINE_EXCEEDED');
    }
  });
});

describe('token 上限', () => {
  it('输入 token 超限被拒绝且不占用调用额度', () => {
    const { ledger } = createLedger();
    expect(() =>
      ledger.authorizeCall({ inputTokens: RUNTIME_LIMITS.workflows.turn.input_tokens_cap + 1, outputTokens: 0 }),
    ).toThrowError(/输入 token/);
    expect(ledger.callsUsed).toBe(0);
  });

  it('输出 token 超限被拒绝', () => {
    const { ledger } = createLedger();
    expect(() =>
      ledger.authorizeCall({ inputTokens: 0, outputTokens: RUNTIME_LIMITS.workflows.turn.output_tokens_cap + 1 }),
    ).toThrowError(/输出 token/);
  });

  it('累计用量而非单次用量参与判定', () => {
    const { ledger } = createLedger();
    const half: BudgetCallAccounting = { inputTokens: RUNTIME_LIMITS.workflows.turn.input_tokens_cap / 2, outputTokens: 0 };
    completeCall(ledger, half);
    completeCall(ledger, half);
    expect(() => ledger.authorizeCall({ inputTokens: 1, outputTokens: 0 })).toThrowError(/输入 token/);
  });

  it('结算把预留替换为实际值，实际更省则退回额度', () => {
    const { ledger } = createLedger();
    const reservation = ledger.authorizeCall({ inputTokens: 1000, outputTokens: 1000 });
    ledger.settle(reservation, { inputTokens: 100, outputTokens: 50 });
    expect(ledger.remainingInputTokens).toBe(RUNTIME_LIMITS.workflows.turn.input_tokens_cap - 100);
    expect(ledger.remainingOutputTokens).toBe(RUNTIME_LIMITS.workflows.turn.output_tokens_cap - 50);
  });
});

describe('共享额度', () => {
  it('schema 修复每 run 只有一次，跨角色共享', () => {
    const { ledger } = createLedger();
    expect(ledger.consumeSchemaRepair()).toBe(true);
    // 第二次调用即失败——这正是 agents.json 的 max_schema_repair_shared=1 语义：
    // 额度属于 run，不属于单个角色。
    expect(ledger.consumeSchemaRepair()).toBe(false);
  });

  it('文本重写每 run 只有一次', () => {
    const { ledger } = createLedger();
    expect(ledger.consumeTextRewrite()).toBe(true);
    expect(ledger.consumeTextRewrite()).toBe(false);
  });

  it('route_review 每 turn 一次', () => {
    const { ledger } = createLedger();
    expect(ledger.consumeRouteReview()).toBe(true);
    expect(ledger.consumeRouteReview()).toBe(false);
  });

  it('route_review 需要预留 PreparationAgent 与 Guard 两次调用', () => {
    const { ledger } = createLedger();
    const max = RUNTIME_LIMITS.workflows.turn.max_calls;
    // 消耗到仅剩 1 次调用额度，不足以容纳 route_review 的两次调用。
    for (let index = 0; index < max - 1; index += 1) completeCall(ledger);
    expect(ledger.remainingCalls).toBe(1);
    expect(ledger.consumeRouteReview()).toBe(false);
  });

  it('额度充足时允许一次 route_review', () => {
    const { ledger } = createLedger();
    expect(ledger.remainingCalls).toBe(RUNTIME_LIMITS.workflows.turn.max_calls);
    expect(ledger.consumeRouteReview()).toBe(true);
  });
});

describe('取消', () => {
  it('cancel 中止 signal 且不可逆', () => {
    const { ledger } = createLedger();
    expect(ledger.signal.aborted).toBe(false);
    ledger.cancel();
    expect(ledger.signal.aborted).toBe(true);
  });
});
