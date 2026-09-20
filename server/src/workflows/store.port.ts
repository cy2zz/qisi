// StorePort：工作流持久化与唯一提交点。
//
// 语义来源 qisi-sdd-v3/contracts/ports.ts（冻结契约）。关键约束：
//   * 「最终业务提交只经 StorePort.commitChecked 或等价 NestJS 领域服务的事务检查。
//      任何 checkpoint 都只是执行快照，不等于业务提交」（AGENTS.md §7）
//   * 「可信服务端上下文提供 owner」——owner 绝不来自 ModelRequest 或客户端入参
//   * 模型调用在数据库事务之外执行；withActiveRun 只包住有界的 SQL 回调
//
// 真实 MySQL 实现归 A（contracts/README.md §12：A 拥有 server/src/shared/db/**），
// B 提供本接口与测试替身（server/src/workflows/memory-store.ts）。

import type { ModelResponse } from '../model/ports.js';
import type { Diagnosis, Strategy } from '../contracts/domain.schema.js';
import type { WorkflowName } from './runtime.js';

export interface SqlTransaction {
  execute<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
  ): Promise<{ rows: Row[]; affectedRows: number }>;
}

/** 领取 run 后获得的执行上下文。leaseToken 是 fencing 凭据，防止旧 worker 提交。 */
export interface ActiveRunContext {
  readonly runId: string;
  readonly leaseToken: string;
  readonly reservedVersion: number | null;
  readonly deadlineAt: string;
}

export interface ReserveInput {
  readonly sessionId: string;
  readonly requestId: string;
  /** payload 的稳定哈希，用于区分同 ID 重放与同 ID 不同内容。 */
  readonly payloadHash: string;
  readonly workflow: WorkflowName;
  readonly expectedVersion: number;
}

export interface ReservedRun {
  readonly runId: string;
  readonly leaseToken: string;
  readonly reservedVersion: number;
  readonly deadlineAt: string;
}

/** 提交时一并原子写入的内容。任一项失败即整体不提交。 */
export interface CheckedMutation {
  readonly sessionId: string;
  /** 对外可见的安全消息（已过滤的投影，非私有对象）。 */
  readonly safeMessageMd: string;
  /** 实际帮助曝光；曝光不可撤销（AGENTS.md §6 第 6 条）。 */
  readonly exposure: unknown;
  /** 写入领域事件。 */
  readonly events: readonly unknown[];
  readonly nextState: unknown;
  /** 该 request 的幂等安全响应。 */
  readonly safeResponse: unknown;
  /** Private checked teaching facts, persisted atomically, never part of the public DTO. */
  readonly teaching?: { readonly diagnosis: Diagnosis; readonly strategy: Strategy };
}

export type StoreErrorCode = 'REQUEST_CONFLICT' | 'VERSION_CONFLICT' | 'BUSY' | 'LEASE_INVALID' | 'NOT_FOUND';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

export interface NodeExecutionAudit {
  readonly modelId: string;
  readonly promptVersion: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Final successful attempt only; not a durable aggregate budget ledger. */
  readonly response: ModelResponse;
}

export interface StorePort {
  /**
   * 建立 run 与 lease。短事务内校验 session.version 且不得存在其他 active_run。
   * 同一 requestId + 相同 payloadHash 已成功时不应再次执行——由
   * getCommittedResult 先行判定。
   */
  reserve(input: ReserveInput): Promise<ReservedRun>;

  /** 仅当 inputHash 与已存节点一致且 lease 仍有效时返回私有结果，否则 null。 */
  getReusableNode(runId: string, nodeKey: string, inputHash: string): Promise<unknown | null>;

  saveNode(runId: string, leaseToken: string, nodeKey: string, inputHash: string, result: unknown, audit?: NodeExecutionAudit): Promise<void>;

  /**
   * **唯一**的业务提交点。单事务写安全检查后的消息、事件、实际曝光、状态/版本与
   * request 安全响应。提交后成为业务事实；此前的一切都只是候选数据。
   */
  commitChecked(runId: string, leaseToken: string, reservedVersion: number, mutation: CheckedMutation): Promise<unknown>;

  /** 撤销会话的活动 lease（取消/删除/过期）。迟到结果此后不得再提交。 */
  revoke(sessionId: string): Promise<void>;

  /**
   * 服务端专用：在有效 owner/run/lease/deadline 下执行有界 SQL 回调。
   * 单个会话只允许一个活动工作流，故此前置校验必须在事务内完成。
   */
  withActiveRun<T>(input: ActiveRunContext, work: (transaction: SqlTransaction) => Promise<T>): Promise<T>;

  /** 提交成功但响应丢失时，据此回放同一安全响应，不重复调模型或重复曝光。 */
  getCommittedResult(runId: string): Promise<unknown | null>;

  /** 有条件接管未完成且未过期的 run，轮换 fencing lease；不复活已删除数据。 */
  claimRecovery(runId: string): Promise<ActiveRunContext | null>;
}
