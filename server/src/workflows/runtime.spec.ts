import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIME_LIMITS, nodeTimeoutMs, workflowBudget } from './runtime.js';

// 规格包只读。路径自 server/src/workflows/ 上溯三级到仓库根。
const runtimeJsonPath = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'runtime.json');

describe('runtime 镜像与规格保持一致', () => {
  it('内嵌常量与 qisi-sdd-v3/runtime.json 深度相等', () => {
    // 内嵌镜像是因为 npm run build 只跑 tsc、不复制资源文件，运行时读不到规格包。
    // 本断言防止规格更新后镜像静默漂移。
    const spec = JSON.parse(readFileSync(runtimeJsonPath, 'utf8'));
    expect(RUNTIME_LIMITS).toEqual(spec);
  });

  it('四条工作流的预算键完整', () => {
    for (const workflow of ['turn', 'prepare', 'transcribe', 'grade'] as const) {
      const budget = workflowBudget(workflow);
      expect(budget.max_calls).toBeGreaterThanOrEqual(budget.normal_calls);
      expect(budget.deadline_ms).toBeGreaterThan(0);
      expect(budget.input_tokens_cap).toBeGreaterThan(0);
      expect(budget.output_tokens_cap).toBeGreaterThan(0);
    }
  });

  it('节点超时按工作流区分且不超过对应 deadline', () => {
    expect(nodeTimeoutMs('prepare')).toBe(RUNTIME_LIMITS.prepare_node_timeout_ms);
    expect(nodeTimeoutMs('turn')).toBe(RUNTIME_LIMITS.node_timeout_ms);
    expect(nodeTimeoutMs('prepare')).toBeLessThanOrEqual(RUNTIME_LIMITS.workflows.prepare.deadline_ms);
    expect(nodeTimeoutMs('turn')).toBeLessThanOrEqual(RUNTIME_LIMITS.workflows.turn.deadline_ms);
  });

  it('禁用隐式重试且不向客户端流式发送未校验内容', () => {
    expect(RUNTIME_LIMITS.model_sdk_max_retries).toBe(0);
    expect(RUNTIME_LIMITS.public_output_streaming).toBe(false);
    expect(RUNTIME_LIMITS.graph.node_retry_policy).toBe('disabled_use_budgeted_ModelPort');
  });

  it('唯一业务提交点是 StorePort.commitChecked', () => {
    expect(RUNTIME_LIMITS.business_commit_owner).toBe('StorePort.commitChecked');
    // checkpoint 不授权提交：与本仓库 docs/adr/001-orchestration.md 的编排决策一致。
    expect(RUNTIME_LIMITS.graph.checkpoint_authorizes_commit).toBe(false);
  });
});
