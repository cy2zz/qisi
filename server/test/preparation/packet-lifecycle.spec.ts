// 教学包生命周期：核对（AT05）、缓存与哈希绑定（AT06）、检验任务池（B02 步骤 3）。
//
// AT05（acceptance/cases.json，layer: unit）
//   Given 包含循环依赖/越界引用/ready且blocking问题
//   When  验证包
//   Then  拒绝并保留needs_review；结构不充当数学认证
//
// AT06（layer: integration）
//   Given 题干或图发生变更
//   When  再次加载教学包
//   Then  旧hash包失效；prepare结果绑定新hash/版本
//
// AT07 是 layer: model_review，**不在本文件内断言通过**。规格要求人工/模型用例保持
// not_run 直到证据包含执行人、commit、题库/model/prompt 版本与实际结果
// （contracts/README.md §10）。本文件只覆盖不依赖真实模型的判定路径。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CheckTaskSchema, PacketSchema, type CheckTask, type Packet } from '../../src/contracts/domain.schema.js';
import { PacketCache, packetReadinessIssues, isStructurallyComplete } from '../../src/features/preparation/packet-cache.js';
import { CheckTaskPool, MIN_CHECK_CANDIDATES } from '../../src/features/preparation/check-task-pool.js';
import { reviewPacket, humanReviewEvidence } from '../../src/features/preparation/packet-verification.js';
import { PrepareWorkflow } from '../../src/workflows/prepare.js';
import { problemContentHash, type RouteGraph } from '../../src/agents/preparation/route-graph.js';

const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');
const packetFixture = PacketSchema.parse(JSON.parse(readFileSync(path.join(fixturesDirectory, 'packet.json'), 'utf8')));
const problemFixture = JSON.parse(readFileSync(path.join(fixturesDirectory, 'problem.json'), 'utf8')) as {
  content_hash: string;
};

function graphOf(packet: Packet): RouteGraph {
  return { decisions: packet.decisions, routes: packet.routes };
}

function review(packet: Packet, expectedHash = problemFixture.content_hash) {
  return reviewPacket({ packet, expectedProblemHash: expectedHash, graph: graphOf(packet), guard: null });
}

// ---------------------------------------------------------------------------
// AT05
// ---------------------------------------------------------------------------

describe('AT05：结构缺陷必须落入 needs_review', () => {
  it('合规的包判定为 ready', () => {
    expect(review(packetFixture).status).toBe('ready');
    expect(review(packetFixture).issues).toEqual([]);
  });

  it('循环依赖 → needs_review', () => {
    const cyclic = PacketSchema.parse({
      ...packetFixture,
      decisions: packetFixture.decisions.map((decision, index) =>
        // 让 d1 反过来依赖 d3，形成 d1 -> d3 -> d2 -> d1
        index === 0 ? { ...decision, prerequisite_ids: ['d3'] } : decision,
      ),
    });

    const outcome = review(cyclic);
    expect(outcome.status).toBe('needs_review');
    expect(outcome.issues.map((item) => item.code)).toContain('PREREQUISITE_CYCLE');
  });

  it('越界引用 → needs_review', () => {
    const dangling = PacketSchema.parse({
      ...packetFixture,
      routes: packetFixture.routes.map((route, index) =>
        index === 0 ? { ...route, terminal_ids: ['不存在的节点'] } : route,
      ),
    });

    const outcome = review(dangling);
    expect(outcome.status).toBe('needs_review');
    expect(outcome.issues.map((item) => item.code)).toContain('TERMINAL_NOT_IN_ROUTE');
  });

  it('ready 为真但同时有 blocking_issues → needs_review', () => {
    const contradicting = PacketSchema.parse({ ...packetFixture, blocking_issues: ['题图缺失，无法核对'] });

    const outcome = review(contradicting);
    expect(outcome.status).toBe('needs_review');
    expect(outcome.issues.some((item) => item.message.includes('blocking_issues'))).toBe(true);
  });

  it('problem_hash 与题目不一致 → needs_review（防止用错题的包）', () => {
    const outcome = review(packetFixture, 'a'.repeat(64));
    expect(outcome.status).toBe('needs_review');
    expect(outcome.issues.some((item) => item.message.includes('problem_hash'))).toBe(true);
  });

  it('结构完备不等于数学已认证——mathCertified 恒为 false', () => {
    const outcome = review(packetFixture);
    expect(outcome.status).toBe('ready');
    // 关键断言：即便结构与四条件全部通过，代码也不得授予数学认证。
    expect(outcome.mathCertified).toBe(false);
  });

  it('模型接受不足以让有结构缺陷的包变为 ready', () => {
    const cyclic = PacketSchema.parse({
      ...packetFixture,
      decisions: packetFixture.decisions.map((decision, index) =>
        index === 0 ? { ...decision, prerequisite_ids: ['d3'] } : decision,
      ),
    });
    const guardAccept = {
      verdict: 'accept' as const,
      math_note: '看起来没问题',
      disclosure_note: '',
      actual_disclosed_ids: [],
      whole_task_disclosed: false,
      issues: [],
    };

    const outcome = reviewPacket({
      packet: cyclic,
      expectedProblemHash: problemFixture.content_hash,
      graph: graphOf(cyclic),
      guard: guardAccept,
    });
    // Guard 是输入之一，不是权威：模型 accept 不能覆盖代码发现的结构缺陷。
    expect(outcome.status).toBe('needs_review');
  });

  it('模型 revise 可以否决一个结构完备的包', () => {
    const outcome = reviewPacket({
      packet: packetFixture,
      expectedProblemHash: problemFixture.content_hash,
      graph: graphOf(packetFixture),
      guard: {
        verdict: 'revise',
        math_note: '第 2 步的取等条件未验证',
        disclosure_note: '',
        actual_disclosed_ids: [],
        whole_task_disclosed: false,
        issues: [],
      },
    });
    expect(outcome.status).toBe('needs_review');
    expect(outcome.issues.some((item) => item.layer === 'guard')).toBe(true);
  });

  it('human_reviewed 记录必须同时有执行者与依据', () => {
    const fake = PacketSchema.parse({
      ...packetFixture,
      verification: [
        { kind: 'human_reviewed', reviewer_or_model: '', reference: '', summary: '', status: 'pass', checked_at: new Date().toISOString() },
      ],
    });
    // 空执行者/空依据的记录不算有效人工核对。
    expect(humanReviewEvidence(fake)).toEqual([]);
    expect(humanReviewEvidence(packetFixture).length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// AT06
// ---------------------------------------------------------------------------

describe('AT06：内容变更使旧包失效，prepare 结果绑定新 hash/版本', () => {
  it('题干变更产生新哈希，旧哈希的包不再命中', () => {
    const base = { statementMd: 'f(x)=x+1/x', source: '自拟', isOfficial: false, assetContentHashes: [] as string[] };
    const oldHash = problemContentHash(base);
    const newHash = problemContentHash({ ...base, statementMd: 'f(x)=x+2/x' });

    const cache = new PacketCache({ configHash: 'cfg', modelId: 'model-a' });
    cache.put(oldHash, PacketSchema.parse({ ...packetFixture, problem_hash: oldHash }));

    expect(cache.isReusable(oldHash)).toBe(true);
    // 题干一变，用新哈希查询自然不命中——不依赖"记得去失效"。
    expect(cache.isReusable(newHash)).toBe(false);
  });

  it('题图字节变更同样产生新哈希', () => {
    const base = { statementMd: 'f(x)=x+1/x', source: '自拟', isOfficial: false, assetContentHashes: ['图A'] };
    expect(problemContentHash(base)).not.toBe(problemContentHash({ ...base, assetContentHashes: ['图B'] }));
  });

  it('缓存键包含 prompt/model/config 版本，任一变化都不得复用', () => {
    const hash = problemFixture.content_hash;
    const base = { configHash: 'cfg', modelId: 'model-a' };

    const a = new PacketCache(base);
    a.put(hash, packetFixture);
    expect(a.isReusable(hash)).toBe(true);

    // 模型变化
    const b = new PacketCache({ ...base, modelId: 'model-b' });
    expect(b.isReusable(hash)).toBe(false);
    // 配置变化
    const c = new PacketCache({ ...base, configHash: 'cfg-2' });
    expect(c.isReusable(hash)).toBe(false);
    // 提示版本变化
    const d = new PacketCache({ ...base, promptVersion: 'prompt-v9.9' });
    expect(d.isReusable(hash)).toBe(false);
  });

  it('拒绝缓存哈希与键不一致的包', () => {
    const cache = new PacketCache({ configHash: 'cfg', modelId: 'm' });
    expect(() => cache.put('f'.repeat(64), packetFixture)).toThrowError(/不一致/);
  });

  it('PrepareWorkflow 的 prepare 结果绑定新 hash 与版本', () => {
    const workflow = new PrepareWorkflow({
      cache: new PacketCache({ configHash: 'cfg', modelId: 'm' }),
      checkTaskPool: new CheckTaskPool(),
    });

    const outcome = workflow.acceptPacket({
      packet: packetFixture,
      expectedProblemHash: problemFixture.content_hash,
      guard: null,
    });

    expect(outcome.status).toBe('ready');
    // 绑定关系：包声明的哈希与版本即 prepare 结果的身份。
    expect(outcome.packet.problem_hash).toBe(problemFixture.content_hash);
    expect(outcome.packet.version.length).toBeGreaterThan(0);
    expect(workflow.loadCached(problemFixture.content_hash)?.version).toBe(packetFixture.version);
  });

  it('needs_review 的包不进入缓存，避免污染后续会话', () => {
    const workflow = new PrepareWorkflow({
      cache: new PacketCache({ configHash: 'cfg', modelId: 'm' }),
      checkTaskPool: new CheckTaskPool(),
    });
    const broken = PacketSchema.parse({ ...packetFixture, blocking_issues: ['题图缺失'] });

    const outcome = workflow.acceptPacket({
      packet: broken,
      expectedProblemHash: problemFixture.content_hash,
      guard: null,
    });

    expect(outcome.status).toBe('needs_review');
    // 未就绪时不返回缓存条目，也不返回伪造的缓存身份。
    expect(outcome.cached).toBeNull();
    expect(workflow.loadCached(problemFixture.content_hash)).toBeNull();
  });

  it('就绪的包返回真实缓存条目，键由四元组构成', () => {
    const workflow = new PrepareWorkflow({
      cache: new PacketCache({ configHash: 'cfg-x', modelId: 'm-x' }),
      checkTaskPool: new CheckTaskPool(),
    });

    const outcome = workflow.acceptPacket({
      packet: packetFixture,
      expectedProblemHash: problemFixture.content_hash,
      guard: null,
    });

    expect(outcome.cached).not.toBeNull();
    // 键包含 problem_hash / promptVersion / modelId / configHash 四段。
    expect(outcome.cached?.key.split(' ')).toEqual([
      problemFixture.content_hash,
      expect.any(String),
      'm-x',
      'cfg-x',
    ]);
  });

  it('题目退役后缓存与候选一并清除', () => {
    const workflow = new PrepareWorkflow({
      cache: new PacketCache({ configHash: 'cfg', modelId: 'm' }),
      checkTaskPool: new CheckTaskPool(),
    });
    workflow.acceptPacket({ packet: packetFixture, expectedProblemHash: problemFixture.content_hash, guard: null });

    const retired = workflow.retireProblem(problemFixture.content_hash);
    expect(retired.cachedRemoved).toBe(1);
    expect(workflow.loadCached(problemFixture.content_hash)).toBeNull();
  });

  it('未就绪的包能被逐条说明缺口，而不是只说一句"未就绪"', () => {
    const broken = PacketSchema.parse({ ...packetFixture, ready: false, blocking_issues: ['缺图'] });
    const issues = packetReadinessIssues(broken, problemFixture.content_hash);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(isStructurallyComplete(broken, problemFixture.content_hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 检验任务池（B02 步骤 3）
// ---------------------------------------------------------------------------

function checkTask(overrides: Record<string, unknown> = {}): CheckTask {
  const template = packetFixture.check_tasks[0] as CheckTask;
  return CheckTaskSchema.parse({ ...template, ...overrides });
}

const noHistory = { seenTaskHashes: new Set<string>(), usedEquivalenceGroups: new Set<string>() };

describe('检验任务池', () => {
  it('登记候选并报告与"至少两项"要求的缺口', () => {
    const pool = new CheckTaskPool();
    const one = pool.register('hash-1', [checkTask({ id: 'c1' })]);
    expect(one.shortfall).toBe(MIN_CHECK_CANDIDATES - 1);

    const two = pool.register('hash-2', [checkTask({ id: 'c2' }), checkTask({ id: 'c3' })]);
    expect(two.shortfall).toBe(0);
  });

  it('重复登记同一候选不重复计入', () => {
    const pool = new CheckTaskPool();
    pool.register('hash-1', [checkTask({ id: 'c1' })]);
    const again = pool.register('hash-1', [checkTask({ id: 'c1' })]);
    expect(again.registered).toBe(0);
    expect(pool.candidates('hash-1')).toHaveLength(1);
  });

  it('未核对的候选不得用于检验', () => {
    const pool = new CheckTaskPool();
    const unverified = checkTask({ id: 'c1', verified: false });
    pool.register('hash-1', [unverified]);

    const eligibility = pool.eligibility(unverified, noHistory);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join()).toMatch(/未核对/);
    expect(pool.selectForTransfer('hash-1', noHistory)).toBeNull();
  });

  it('已向该 owner 展示过的任务不得复用', () => {
    const pool = new CheckTaskPool();
    const task = checkTask({ id: 'c1', verified: true, relation: 'near_transfer' });
    pool.register('hash-1', [task]);

    const history = { seenTaskHashes: new Set([task.content_hash]), usedEquivalenceGroups: new Set<string>() };
    expect(pool.eligibility(task, history).eligible).toBe(false);
  });

  it('等价组已使用过的候选不得复用', () => {
    const pool = new CheckTaskPool();
    const task = checkTask({ id: 'c1', verified: true, relation: 'near_transfer' });
    pool.register('hash-1', [task]);

    const history = { seenTaskHashes: new Set<string>(), usedEquivalenceGroups: new Set([task.equivalence_group]) };
    expect(pool.eligibility(task, history).eligible).toBe(false);
  });

  it('near_duplicate 可作带标识练习，但不计迁移独立通过', () => {
    const pool = new CheckTaskPool();
    const duplicate = checkTask({ id: 'c1', verified: true, relation: 'near_duplicate' });
    pool.register('hash-1', [duplicate]);

    const eligibility = pool.eligibility(duplicate, noHistory);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join()).toMatch(/near_duplicate/);
  });

  it('全部条件满足时选中最近的可用候选', () => {
    const pool = new CheckTaskPool();
    const blocked = checkTask({ id: 'c-blocked', verified: false });
    const usable = checkTask({ id: 'c-usable', verified: true, relation: 'near_transfer' });
    pool.register('hash-1', [blocked, usable]);

    expect(pool.selectForTransfer('hash-1', noHistory)?.id).toBe('c-usable');
  });

  it('可用性报告逐条列出原因，供覆盖率呈现而非静默过滤', () => {
    const pool = new CheckTaskPool();
    const unverified = checkTask({ id: 'c1', verified: false });
    pool.register('hash-1', [unverified]);

    const report = pool.eligibilityReport('hash-1', noHistory);
    expect(report).toHaveLength(1);
    expect(report[0]?.eligible).toBe(false);
    expect(report[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('内容哈希变更后候选整体退役', () => {
    const pool = new CheckTaskPool();
    pool.register('hash-1', [checkTask({ id: 'c1' })]);
    expect(pool.retire('hash-1')).toBe(1);
    expect(pool.candidates('hash-1')).toEqual([]);
  });

  it('describeGaps 汇总准备缺口', () => {
    const workflow = new PrepareWorkflow({
      cache: new PacketCache({ configHash: 'cfg', modelId: 'm' }),
      checkTaskPool: new CheckTaskPool(),
    });
    // 尚未备课：应报告"没有就绪的教学包"。
    expect(workflow.describeGaps('unknown-hash').join()).toMatch(/没有就绪的教学包/);
  });
});
