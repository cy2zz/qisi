// 上游模型端口桥接的桥接语义与能力降级。

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UpstreamModelBridge, UpstreamCapabilityError } from './upstream-model-bridge.js';
import type { ModelPort as UpstreamModelPort, ModelRequest as UpstreamRequest, ModelResponse as UpstreamResponse } from './model.port.js';
import { BudgetedModelPort } from './budgeted.provider.js';
import { BudgetLedger } from './budget.js';
import type { ModelRequest } from './ports.js';
import { RUNTIME_LIMITS } from '../workflows/runtime.js';

const answerSchema = z.strictObject({ text_md: z.string() });

/** 记录上游实际收到的请求，用于断言桥接的映射行为。 */
class RecordingUpstream implements UpstreamModelPort {
  readonly requests: UpstreamRequest[] = [];
  readonly #response: UpstreamResponse;

  constructor(response?: Partial<UpstreamResponse>) {
    this.#response = {
      elapsedMs: 42,
      model: 'upstream-model',
      parsed: { text_md: '上游返回' },
      provider: 'openai-compatible',
      providerRequestId: 'req-upstream-1',
      usage: { input: 11, kind: 'reported', output: 7 },
      ...response,
    };
  }

  generate(request: UpstreamRequest): Promise<UpstreamResponse> {
    this.requests.push(request);
    return Promise.resolve(this.#response);
  }
}

function bridgeRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    role: 'diagnosis',
    model: 'b-per-role-model',
    system: '角色提示',
    input: { task_id: 'self-001' },
    outputSchema: answerSchema,
    maxOutputTokens: 256,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('桥接映射', () => {
  it('把非字符串 input 序列化为 JSON 交给上游', async () => {
    const upstream = new RecordingUpstream();
    await new UpstreamModelBridge(upstream).generate(bridgeRequest({ input: { a: 1, b: '二' } }));

    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.input).toBe('{"a":1,"b":"二"}');
  });

  it('字符串 input 原样传递，不做二次编码', async () => {
    const upstream = new RecordingUpstream();
    await new UpstreamModelBridge(upstream).generate(bridgeRequest({ input: '原始文本' }));
    expect(upstream.requests[0]?.input).toBe('原始文本');
  });

  it('透传 role、maxOutputTokens 与 signal', async () => {
    const upstream = new RecordingUpstream();
    const controller = new AbortController();
    await new UpstreamModelBridge(upstream).generate(
      bridgeRequest({ role: 'strategy', system: '策略提示', maxOutputTokens: 512, signal: controller.signal }),
    );

    const sent = upstream.requests[0];
    expect(sent?.role).toBe('strategy');
    expect(sent?.maxOutputTokens).toBe(512);
    expect(sent?.signal).toBe(controller.signal);
    // system 不是原样透传：桥接会追加输出契约（见「输出契约必须以 JSON Schema 告知模型」）。
    expect(sent?.system.startsWith('策略提示')).toBe(true);
  });

  it('忽略 B 的 per-role model——上游只认配置项 AI_MODEL（能力降级，已在文件头声明）', async () => {
    const upstream = new RecordingUpstream();
    await new UpstreamModelBridge(upstream).generate(bridgeRequest({ model: 'b-diagnosis-model' }));

    const sent = upstream.requests[0] as unknown as Record<string, unknown>;
    expect(sent).not.toHaveProperty('model');
  });

  it('透传上游的 provider / model / usage / 时延 / requestId', async () => {
    const upstream = new RecordingUpstream();
    const response = await new UpstreamModelBridge(upstream).generate(bridgeRequest());

    expect(response.provider).toBe('openai-compatible');
    expect(response.model).toBe('upstream-model');
    expect(response.usage).toEqual({ input: 11, kind: 'reported', output: 7 });
    expect(response.elapsedMs).toBe(42);
    expect(response.providerRequestId).toBe('req-upstream-1');
    expect(response.parsed).toEqual({ text_md: '上游返回' });
  });

  it('上游未返回 requestId 时不伪造该字段', async () => {
    const upstream = new RecordingUpstream({ providerRequestId: undefined });
    const response = await new UpstreamModelBridge(upstream).generate(bridgeRequest());

    expect(Object.prototype.hasOwnProperty.call(response, 'providerRequestId')).toBe(false);
  });
});

describe('输出契约必须以 JSON Schema 告知模型', () => {
  // 上游适配器不接收 outputSchema，模型因此看不到字段名。规格包的角色提示是中文散文，
  // 通篇无字段名——实测中模型据此自造了 gap_type/description 等字段，结构校验必然失败。
  it('把 outputSchema 转成 JSON Schema 注入 system', async () => {
    const upstream = new RecordingUpstream();
    await new UpstreamModelBridge(upstream).generate(
      bridgeRequest({ outputSchema: z.strictObject({ task_id: z.string(), verdict: z.enum(['a', 'b']) }) }),
    );

    const system = upstream.requests[0]?.system ?? '';
    expect(system).toContain('JSON Schema');
    // 字段名与枚举必须真的出现在提示里，否则模型仍会猜。
    expect(system).toContain('task_id');
    expect(system).toContain('verdict');
    expect(system).toContain('"enum":["a","b"]');
    // additionalProperties:false 也要传达，否则模型会自作主张加字段。
    expect(system).toContain('"additionalProperties":false');
  });

  it('原角色提示正文保留在 system 开头，不被替换', async () => {
    const upstream = new RecordingUpstream();
    await new UpstreamModelBridge(upstream).generate(bridgeRequest({ system: '诊断角色规范正文' }));

    const system = upstream.requests[0]?.system ?? '';
    expect(system.startsWith('诊断角色规范正文')).toBe(true);
  });

  it('system 中必然出现 json 字样——上游 json_object 模式要求', async () => {
    const upstream = new RecordingUpstream();
    // 规格包的真实角色提示并不含该词，注入 schema 后必须补上，
    // 否则 OpenAI 兼容网关返回 400。
    await new UpstreamModelBridge(upstream).generate(bridgeRequest({ system: '输出Diagnosis，不附自由文本' }));

    expect((upstream.requests[0]?.system ?? '').toLowerCase()).toContain('json');
  });

  it('契约无法转换时抛错，而不是发一个模型看不到契约的请求', async () => {
    const upstream = new RecordingUpstream();
    // z.date() 无法表示为 JSON Schema（Zod 4 会抛 "Date cannot be represented..."）。
    // B 的领域契约用 z.iso.datetime() 字符串，不受影响；此用例守住"转换失败必须显式失败"。
    const unconvertible = z.strictObject({ at: z.date() });

    await expect(
      new UpstreamModelBridge(upstream).generate(bridgeRequest({ outputSchema: unconvertible as never })),
    ).rejects.toThrowError(/输出契约无法转换为 JSON Schema/);
    expect(upstream.requests).toEqual([]);
  });

  it('注入 schema 不改变 B 侧看到的 input——上游只拿到序列化后的 input', async () => {
    const upstream = new RecordingUpstream();
    await new UpstreamModelBridge(upstream).generate(bridgeRequest({ input: { task_id: 'self-001' } }));

    expect(upstream.requests[0]?.input).toBe('{"task_id":"self-001"}');
    expect(upstream.requests[0]?.input).not.toContain('JSON Schema');
  });
});

describe('能力降级必须显式失败', () => {
  it('带图请求抛 UpstreamCapabilityError，而不是静默丢图', async () => {
    const upstream = new RecordingUpstream();
    const bridge = new UpstreamModelBridge(upstream);

    await expect(
      bridge.generate(
        bridgeRequest({ role: 'vision', images: [{ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] }),
      ),
    ).rejects.toBeInstanceOf(UpstreamCapabilityError);

    // 关键：拒绝发生在调用上游之前——不能先发一个无图的请求再期望它失败。
    expect(upstream.requests).toEqual([]);
  });

  it('空图片数组视为无图，正常通过', async () => {
    const upstream = new RecordingUpstream();
    await expect(new UpstreamModelBridge(upstream).generate(bridgeRequest({ images: [] }))).resolves.toBeDefined();
  });

  it('错误信息写明 capability/role 与实际图片数，便于定位', async () => {
    const bridge = new UpstreamModelBridge(new RecordingUpstream());

    await expect(
      bridge.generate(bridgeRequest({ role: 'vision', images: [{ mime: 'image/jpeg', bytes: new Uint8Array([1]) }] })),
    ).rejects.toMatchObject({ capability: 'images', role: 'vision', name: 'UpstreamCapabilityError' });

    await expect(
      bridge.generate(bridgeRequest({ role: 'vision', images: [{ mime: 'image/jpeg', bytes: new Uint8Array([1]) }] })),
    ).rejects.toThrowError(/1 张图/);
  });

  it('不可序列化的 input 抛错，而不是把无意义字符串喂给模型', async () => {
    const upstream = new RecordingUpstream();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    await expect(new UpstreamModelBridge(upstream).generate(bridgeRequest({ input: circular }))).rejects.toThrowError(
      /无法序列化/,
    );
    expect(upstream.requests).toEqual([]);
  });
});

describe('与预算装饰器组合', () => {
  it('上游报 unknown usage 时，装饰器替换为保守估计而非按零消耗放过', async () => {
    const upstream = new RecordingUpstream({ usage: { input: 0, kind: 'unknown', output: 0 } });
    const ledger = new BudgetLedger({
      workflow: 'turn',
      deadlineAt: new Date(Date.now() + RUNTIME_LIMITS.workflows.turn.deadline_ms),
    });
    const port = new BudgetedModelPort(new UpstreamModelBridge(upstream), ledger);

    const response = await port.generate(bridgeRequest({ maxOutputTokens: 400 }));

    expect(response.usage.kind).toBe('estimated');
    expect(response.usage.output).toBe(400);
    expect(response.usage.input).toBeGreaterThan(0);
    // 消耗已计入账本，未按 0 记账。
    expect(ledger.remainingOutputTokens).toBeLessThan(RUNTIME_LIMITS.workflows.turn.output_tokens_cap);
  });

  it('上游报 reported usage 时按实际值结算', async () => {
    const upstream = new RecordingUpstream({ usage: { input: 100, kind: 'reported', output: 50 } });
    const ledger = new BudgetLedger({
      workflow: 'turn',
      deadlineAt: new Date(Date.now() + RUNTIME_LIMITS.workflows.turn.deadline_ms),
    });
    const port = new BudgetedModelPort(new UpstreamModelBridge(upstream), ledger);

    const response = await port.generate(bridgeRequest());

    expect(response.usage).toEqual({ input: 100, kind: 'reported', output: 50 });
    expect(ledger.remainingOutputTokens).toBe(RUNTIME_LIMITS.workflows.turn.output_tokens_cap - 50);
  });

  it('结构不合格时走装饰器的修复路径，桥接层不干预', async () => {
    const upstream = new RecordingUpstream({ parsed: { wrong_field: true } });
    const ledger = new BudgetLedger({
      workflow: 'turn',
      deadlineAt: new Date(Date.now() + RUNTIME_LIMITS.workflows.turn.deadline_ms),
    });
    const port = new BudgetedModelPort(new UpstreamModelBridge(upstream), ledger);

    // 修复会把校验原因回注 system 后重发一次；两次都拿同一份上游响应，故最终失败。
    await expect(port.generate(bridgeRequest())).rejects.toThrowError(/不符合/);
    expect(upstream.requests).toHaveLength(2);
    expect(upstream.requests[1]?.system).not.toBe(upstream.requests[0]?.system);
  });
});
