// 工作流预算与运行时上限。
//
// 数值唯一来源是 qisi-sdd-v3/runtime.json（只读规格包）。该文件不在 server/ 内，
// 而 `npm run build` 只跑 tsc、不复制任何资源文件，因此运行时无法直接读它——
// 这正是 server/src/prompts 采用同一策略的原因。
//
// 策略：此处内嵌一份镜像常量，并由 runtime.spec.ts 深度比对该 JSON。规格更新而
// 镜像未同步时测试失败，避免静默漂移。修改数值必须同时改 runtime.json——但那属
// 规格包，需走变更流程，不得为通过测试而反改规格。

export interface WorkflowBudget {
  readonly normal_calls: number;
  readonly max_calls: number;
  readonly deadline_ms: number;
  readonly input_tokens_cap: number;
  readonly output_tokens_cap: number;
}

export type WorkflowName = 'turn' | 'prepare' | 'transcribe' | 'grade';

export const RUNTIME_LIMITS = {
  version: 'qisi-3.1',
  runner: 'nestjs_worker_with_optional_langgraphjs',
  api_worker_separation: true,
  single_recovery_worker: true,
  workflows: {
    turn: { normal_calls: 4, max_calls: 7, deadline_ms: 90000, input_tokens_cap: 24000, output_tokens_cap: 8000 },
    prepare: { normal_calls: 2, max_calls: 4, deadline_ms: 180000, input_tokens_cap: 32000, output_tokens_cap: 16000 },
    transcribe: { normal_calls: 1, max_calls: 2, deadline_ms: 45000, input_tokens_cap: 12000, output_tokens_cap: 6000 },
    grade: { normal_calls: 2, max_calls: 3, deadline_ms: 60000, input_tokens_cap: 20000, output_tokens_cap: 6000 },
  },
  schema_repairs_per_run: 1,
  text_rewrites_per_run: 1,
  probe_limit_per_canonical_goal: 2,
  route_reviews_per_turn: 1,
  max_concurrent_model_calls: 4,
  media_max_bytes: 8388608,
  media_max_pixels: 20000000,
  media_ttl_hours: 24,
  session_ttl_days: 7,
  text_max_chars: 12000,
  node_timeout_ms: 25000,
  prepare_node_timeout_ms: 60000,
  public_output_streaming: false,
  latency_targets: { warm_turn_p50_ms: 15000, warm_turn_p95_ms: 35000, status: 'not_measured' },
  model_sdk: 'ai_sdk_core',
  model_sdk_max_retries: 0,
  business_commit_owner: 'StorePort.commitChecked',
  database: {
    engine: 'mysql',
    version_line: '8.4',
    driver: 'mysql2',
    engine_storage: 'InnoDB',
    charset: 'utf8mb4',
    transaction_isolation: 'READ COMMITTED',
    time_zone: '+00:00',
    pool_max: 10,
    workflow_state_store: 'same_mysql_database',
    checkpoint_store: 'optional_same_mysql_database_after_conformance',
    automatic_in_memory_fallback: false,
  },
  graph: {
    api: 'StateGraph',
    checkpoint_thread_key: 'run_id',
    recursion_limit: 32,
    node_retry_policy: 'disabled_use_budgeted_ModelPort',
    checkpoint_authorizes_commit: false,
    client_supplied_checkpoint_ids: false,
  },
} as const;

/**
 * 单节点的墙钟上限：prepare 节点 60 秒，普通节点 25 秒，
 * 且都受 workflow 剩余 deadline 进一步截短（contracts/README.md §6）。
 */
export function nodeTimeoutMs(workflow: WorkflowName): number {
  return workflow === 'prepare' ? RUNTIME_LIMITS.prepare_node_timeout_ms : RUNTIME_LIMITS.node_timeout_ms;
}

export function workflowBudget(workflow: WorkflowName): WorkflowBudget {
  return RUNTIME_LIMITS.workflows[workflow];
}
