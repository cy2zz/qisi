// StorePort 协议测试：幂等、版本 CAS、lease/fencing、节点复用与禁止提交路径。
//
// 边界声明：本文件验证的是**受控内核协议**，用内存替身执行。
// 它不证明 MySQL 持久化、跨进程重启或真实竞态——那需要 A 的数据库门面与 B07 联调，
// 缺 MySQL 8.4 环境时 ST06 必须记 blocked_external（workflow-persistence.md §6）。

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/workflows/memory-store.js';
import { StoreError, type CheckedMutation } from '../../src/workflows/store.port.js';

const SESSION = 'session-1';

function createStore() {
  const store = new MemoryStore();
  store.seedSession(SESSION, 1);
  return store;
}

function mutation(overrides: Partial<CheckedMutation> = {}): CheckedMutation {
  return {
    sessionId: SESSION,
    safeMessageMd: '已检查的教学消息',
    exposure: { disclosures: ['d1'], whole_task: false },
    events: [{ type: 'turn_committed' }],
    nextState: { current_goal: 'self-001:d1' },
    safeResponse: { text_md: '已检查的教学消息' },
    ...overrides,
  };
}

async function reserveRun(store: MemoryStore, requestId = 'req-1', payloadHash = 'payload-1', expectedVersion = 1) {
  return store.reserve({ sessionId: SESSION, requestId, payloadHash, workflow: 'turn', expectedVersion });
}

describe('reserve：幂等与并发', () => {
  it('正常建立 run 并占用会话的活动位', async () => {
    const store = createStore();
    const run = await reserveRun(store);

    expect(run.runId).toBeTruthy();
    expect(run.reservedVersion).toBe(1);
    expect(store.activeRunOf(SESSION)).toBe(run.runId);
  });

  it('同一会话不允许两个活动 run', async () => {
    const store = createStore();
    await reserveRun(store, 'req-1');
    // 不同 requestId、同一会话：必须 BUSY，避免并发轮覆盖。
    await expect(reserveRun(store, 'req-2', 'payload-2')).rejects.toMatchObject({ code: 'BUSY' });
  });

  it('版本不一致时拒绝（CAS）', async () => {
    const store = createStore();
    await expect(reserveRun(store, 'req-1', 'payload-1', 99)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('同 requestId 同 payload 再次进入时不得重复建立 run', async () => {
    const store = createStore();
    await reserveRun(store, 'req-1', 'payload-1');
    // 幂等键已存在：调用方应先查 getCommittedResult 回放，而不是重跑。
    await expect(reserveRun(store, 'req-1', 'payload-1')).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  });

  it('同 requestId 不同 payload 是冲突，不是重试理由', async () => {
    const store = createStore();
    await reserveRun(store, 'req-1', 'payload-1');
    await expect(reserveRun(store, 'req-1', 'payload-DIFFERENT')).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  });

  it('已删除的会话不得被复活', async () => {
    const store = createStore();
    store.markDeleted(SESSION);
    await expect(reserveRun(store)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('commitChecked：唯一提交点', () => {
  it('提交后版本递增、活动位释放、安全响应可回放', async () => {
    const store = createStore();
    const run = await reserveRun(store);

    const committed = await store.commitChecked(run.runId, run.leaseToken, run.reservedVersion, mutation());

    expect(committed).toEqual({ text_md: '已检查的教学消息' });
    expect(store.sessionVersion(SESSION)).toBe(2);
    expect(store.activeRunOf(SESSION)).toBeNull();
    expect(store.lastSafeMessage(SESSION)).toBe('已检查的教学消息');
    expect(await store.getCommittedResult(run.runId)).toEqual({ text_md: '已检查的教学消息' });
  });

  it('提交版本与预留不一致时拒绝', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await expect(store.commitChecked(run.runId, run.leaseToken, 42, mutation())).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });

  it('过期 lease 凭据不得提交（迟到结果丢弃）', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await expect(store.commitChecked(run.runId, 'lease-stale', run.reservedVersion, mutation())).rejects.toMatchObject({
      code: 'LEASE_INVALID',
    });
  });

  it('会话被撤销后，迟到的提交被拒绝且不写入任何内容', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await store.revoke(SESSION);

    await expect(store.commitChecked(run.runId, run.leaseToken, run.reservedVersion, mutation())).rejects.toMatchObject({
      code: 'LEASE_INVALID',
    });
    expect(store.lastSafeMessage(SESSION)).toBeNull();
    expect(store.sessionVersion(SESSION)).toBe(1);
  });

  it('提交后可以开始下一轮（版本已推进）', async () => {
    const store = createStore();
    const first = await reserveRun(store, 'req-1', 'payload-1', 1);
    await store.commitChecked(first.runId, first.leaseToken, first.reservedVersion, mutation());

    const second = await reserveRun(store, 'req-2', 'payload-2', store.sessionVersion(SESSION));
    expect(second.reservedVersion).toBe(2);
  });
});

describe('节点复用', () => {
  it('输入哈希一致时复用结果', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await store.saveNode(run.runId, run.leaseToken, 'diagnosis', 'hash-a', { judgment: 'invalid' });

    expect(await store.getReusableNode(run.runId, 'diagnosis', 'hash-a')).toEqual({ judgment: 'invalid' });
  });

  it('输入哈希不一致时不复用——模型/提示/配置变化必须使旧节点失效', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await store.saveNode(run.runId, run.leaseToken, 'diagnosis', 'hash-a', { judgment: 'invalid' });

    expect(await store.getReusableNode(run.runId, 'diagnosis', 'hash-b')).toBeNull();
  });

  it('不同 run 之间不串用节点结果', async () => {
    const store = createStore();
    const first = await reserveRun(store, 'req-1', 'payload-1', 1);
    await store.saveNode(first.runId, first.leaseToken, 'diagnosis', 'hash-a', { judgment: 'invalid' });
    await store.commitChecked(first.runId, first.leaseToken, first.reservedVersion, mutation());

    const second = await reserveRun(store, 'req-2', 'payload-2', store.sessionVersion(SESSION));
    expect(await store.getReusableNode(second.runId, 'diagnosis', 'hash-a')).toBeNull();
  });

  it('lease 失效时不得写入节点', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await expect(store.saveNode(run.runId, 'lease-stale', 'diagnosis', 'hash-a', {})).rejects.toBeInstanceOf(StoreError);
  });
});

describe('恢复', () => {
  it('claimRecovery 轮换 lease，旧凭据随即失效', async () => {
    const store = createStore();
    const run = await reserveRun(store);

    const recovered = await store.claimRecovery(run.runId);
    expect(recovered).not.toBeNull();
    expect(recovered?.leaseToken).not.toBe(run.leaseToken);

    // 旧 worker 的迟到提交必须被拒绝。
    await expect(store.commitChecked(run.runId, run.leaseToken, run.reservedVersion, mutation())).rejects.toMatchObject({
      code: 'LEASE_INVALID',
    });
    // 新 lease 可以提交。reservedVersion 在 ActiveRunContext 中可空，
    // 恢复路径下它应等于原 run 的预留版本。
    expect(recovered?.reservedVersion).toBe(run.reservedVersion);
    await expect(
      store.commitChecked(run.runId, recovered!.leaseToken, run.reservedVersion, mutation()),
    ).resolves.toBeTruthy();
  });

  it('已提交的 run 不可被接管', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await store.commitChecked(run.runId, run.leaseToken, run.reservedVersion, mutation());
    expect(await store.claimRecovery(run.runId)).toBeNull();
  });

  it('已撤销的 run 不可被接管', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await store.revoke(SESSION);
    expect(await store.claimRecovery(run.runId)).toBeNull();
  });

  it('不存在的 run 返回 null 而非抛错', async () => {
    const store = createStore();
    expect(await store.claimRecovery('run-does-not-exist')).toBeNull();
  });
});

describe('withActiveRun', () => {
  it('lease 有效时执行回调', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    const result = await store.withActiveRun(run, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('lease 失效时拒绝进入回调', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await store.revoke(SESSION);
    await expect(store.withActiveRun(run, () => Promise.resolve('ok'))).rejects.toMatchObject({ code: 'LEASE_INVALID' });
  });

  it('内存替身不执行 SQL，避免被误当作 MySQL 门面', async () => {
    const store = createStore();
    const run = await reserveRun(store);
    await expect(
      store.withActiveRun(run, (transaction) => transaction.execute('select 1', [])),
    ).rejects.toThrowError(/内存替身不执行 SQL/);
  });
});
