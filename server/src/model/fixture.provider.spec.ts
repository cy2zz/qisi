import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FIXTURE_PROVIDER_NAME, FixtureProvider, FixtureTimeoutError, MissingFixtureError } from './fixture.provider.js';
import type { ModelRequest } from './ports.js';

const answerSchema = z.strictObject({ text_md: z.string() });

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    role: 'diagnosis',
    model: 'fixture-text',
    system: 'diagnosis 角色提示',
    input: { task_id: 'self-001' },
    outputSchema: answerSchema,
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('夹具消费与调用记录', () => {
  it('按 role FIFO 消费夹具', async () => {
    const provider = new FixtureProvider()
      .enqueue('diagnosis', { id: 'd-1', parsed: { text_md: 'first' } })
      .enqueue('diagnosis', { id: 'd-2', parsed: { text_md: 'second' } });

    const first = await provider.generate(request());
    const second = await provider.generate(request());

    expect(first.providerRequestId).toBe('fixture-d-1');
    expect(second.providerRequestId).toBe('fixture-d-2');
    expect(provider.calls.map((call) => call.fixtureId)).toEqual(['d-1', 'd-2']);
  });

  it('记录 role 调用序列，可证明多阶段不是一次调用伪造', async () => {
    const provider = new FixtureProvider()
      .enqueue('diagnosis', { id: 'd-1', parsed: { text_md: 'x' } })
      .enqueue('strategy', { id: 's-1', parsed: { text_md: 'y' } })
      .enqueue('renderer', { id: 'r-1', parsed: { text_md: 'z' } });

    await provider.generate(request({ role: 'diagnosis' }));
    await provider.generate(request({ role: 'strategy' }));
    await provider.generate(request({ role: 'renderer' }));

    expect(provider.roleSequence).toEqual(['diagnosis', 'strategy', 'renderer']);
    expect(new Set(provider.calls.map((call) => call.fixtureId))).toEqual(new Set(['d-1', 's-1', 'r-1']));
  });

  it('记录 system 与 input 摘要，可证明各角色上下文投影不同', async () => {
    const provider = new FixtureProvider()
      .enqueue('diagnosis', { id: 'd-1', parsed: { text_md: 'x' } })
      .enqueue('strategy', { id: 's-1', parsed: { text_md: 'y' } });

    await provider.generate(request({ role: 'diagnosis', system: 'role A', input: { a: 1 } }));
    await provider.generate(request({ role: 'strategy', system: 'role B', input: { b: 2 } }));

    const [diagnosisCall, strategyCall] = provider.calls;
    expect(diagnosisCall?.systemDigest).not.toBe(strategyCall?.systemDigest);
    expect(diagnosisCall?.inputDigest).not.toBe(strategyCall?.inputDigest);
  });

  it('相同输入产生相同摘要，摘要只反映内容', async () => {
    const provider = new FixtureProvider()
      .enqueue('diagnosis', { id: 'a', parsed: { text_md: 'x' } })
      .enqueue('diagnosis', { id: 'b', parsed: { text_md: 'x' } });

    await provider.generate(request({ system: 'same', input: { a: 1 } }));
    await provider.generate(request({ system: 'same', input: { a: 1 } }));

    expect(provider.calls[0]?.inputDigest).toBe(provider.calls[1]?.inputDigest);
  });

  it('记录图片数量', async () => {
    const provider = new FixtureProvider().enqueue('vision', { id: 'v-1', parsed: { text_md: 'x' } });
    await provider.generate(
      request({
        role: 'vision',
        images: [{ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
      }),
    );
    expect(provider.calls[0]?.imageCount).toBe(1);
  });
});

describe('缺少匹配夹具必须失败', () => {
  it('未注册任何夹具时抛 MissingFixtureError', async () => {
    const provider = new FixtureProvider();
    await expect(provider.generate(request())).rejects.toBeInstanceOf(MissingFixtureError);
  });

  it('队列耗尽后抛 MissingFixtureError，不返回通用成功结果', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'only-one', parsed: { text_md: 'x' } });
    await provider.generate(request());
    await expect(provider.generate(request())).rejects.toBeInstanceOf(MissingFixtureError);
  });

  it('其他 role 的夹具不会被借用', async () => {
    const provider = new FixtureProvider().enqueue('strategy', { id: 's-1', parsed: { text_md: 'x' } });
    await expect(provider.generate(request({ role: 'diagnosis' }))).rejects.toMatchObject({
      name: 'MissingFixtureError',
      role: 'diagnosis',
    });
  });

  it('错误的请求不写入调用记录', async () => {
    const provider = new FixtureProvider();
    await expect(provider.generate(request())).rejects.toBeInstanceOf(MissingFixtureError);
    expect(provider.calls).toEqual([]);
  });
});

describe('故障注入', () => {
  it('malformed 返回无法通过输出契约的值', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'bad', parsed: { text_md: 'x' }, behaviour: 'malformed' });
    const response = await provider.generate(request());
    expect(answerSchema.safeParse(response.parsed).success).toBe(false);
  });

  it('error 注入 provider 错误', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'boom', parsed: {}, behaviour: 'error' });
    await expect(provider.generate(request())).rejects.toThrowError(/boom/);
  });

  it('cancel 以 AbortError 失败', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'c', parsed: {}, behaviour: 'cancel' });
    await expect(provider.generate(request())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('timeout 以 FixtureTimeoutError 失败', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 't', parsed: {}, behaviour: 'timeout', delayMs: 1 });
    await expect(provider.generate(request())).rejects.toBeInstanceOf(FixtureTimeoutError);
  });

  it('signal 已中止时，延迟响应以 AbortError 失败', async () => {
    const controller = new AbortController();
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'slow', parsed: {}, delayMs: 5 });
    const pending = provider.generate(request({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('故障注入同样写入调用记录，便于断言尝试次数', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'boom', parsed: {}, behaviour: 'error' });
    await expect(provider.generate(request())).rejects.toThrow();
    expect(provider.calls).toHaveLength(1);
  });
});

describe('usage 与 provider 标识', () => {
  it('unknown_usage 如实返回 unknown，不伪装成 reported', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', {
      id: 'u',
      parsed: { text_md: 'x' },
      behaviour: 'unknown_usage',
    });
    const response = await provider.generate(request());
    expect(response.usage.kind).toBe('unknown');
  });

  it('provider 标识默认为 fixture，可区分真实适配器', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'p', parsed: { text_md: 'x' } });
    const response = await provider.generate(request());
    expect(response.provider).toBe(FIXTURE_PROVIDER_NAME);
  });
});

describe('reset', () => {
  it('清空队列与调用记录', async () => {
    const provider = new FixtureProvider().enqueue('diagnosis', { id: 'a', parsed: { text_md: 'x' } });
    await provider.generate(request());
    provider.reset();
    expect(provider.calls).toEqual([]);
    await expect(provider.generate(request())).rejects.toBeInstanceOf(MissingFixtureError);
  });
});
