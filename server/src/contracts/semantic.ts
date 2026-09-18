// 跨字段 / 引用 / 授权 / 曝光语义校验。
//
// 规格分工（qisi-sdd-v3/contracts/README.md 第 3 行）：
//   「48个严格JSON Schema见domain.schema.json …… Schema只控制结构，本文件中的
//     引用、数学、授权、曝光与幂等规则必须另写代码测试。」
// 因此本模块承载 domain.schema.ts 表达不了的约束，并被 FixtureProvider 与
// PolicyGate 复用。所有函数为纯函数：不读环境、不写状态、不做网络调用。

import type { Decision, Diagnosis, Packet, Report, Route, SelectInput, Strategy, TranscriptDraft } from './domain.schema.js';

export type SemanticIssueCode =
  | 'PACKET_READY_WITH_BLOCKING_ISSUES'
  | 'PACKET_READY_WITHOUT_REFERENCE_SOURCE'
  | 'PACKET_HASH_MISMATCH'
  | 'ROUTE_REFERENCES_UNKNOWN_DECISION'
  | 'ROUTE_TERMINAL_NOT_IN_ROUTE'
  | 'DECISION_PREREQUISITE_UNKNOWN'
  | 'DECISION_PREREQUISITE_CYCLE'
  | 'STRATEGY_DISCLOSURE_RESERVED_OVERLAP'
  | 'STRATEGY_DISCLOSURE_UNKNOWN_DECISION'
  | 'EVIDENCE_UNKNOWN_SUBMISSION'
  | 'EVIDENCE_UNKNOWN_REVISION'
  | 'EVIDENCE_QUOTE_NOT_FOUND'
  | 'REPORT_INDEPENDENCE_CONTRADICTION'
  | 'TRANSCRIPT_DRAFT_SELF_CONFIRMED'
  | 'SELECT_RANDOM_WITH_PROBLEM_ID';

export interface SemanticIssue {
  readonly code: SemanticIssueCode;
  readonly path: string;
  readonly message: string;
}

/**
 * 校验所需的可信事实。**只能来自服务端**：owner 归属、版本、题库哈希与已确认提交
 * 均由领域服务提供，绝不接受模型输出或客户端入参（见 contracts/README.md §2 信任边界）。
 */
export interface SemanticContext {
  /** 当前 task 内有效 decision id 集合，来自已批准的 Packet / RoutePatch。 */
  readonly knownDecisionIds?: ReadonlySet<string>;
  /** 该题的内容哈希，用于核对 Packet.problem_hash。 */
  readonly expectedProblemHash?: string;
  /** 当前有效且已确认的提交，按 submission_id 索引。 */
  readonly confirmedSubmissions?: ReadonlyMap<string, ConfirmedSubmissionFact>;
}

/** 一次已确认提交的可核对事实：有效 revision 及其正文。 */
export interface ConfirmedSubmissionFact {
  readonly id: string;
  readonly revisions: readonly number[];
  readonly textByRevision: ReadonlyMap<number, string>;
}

const issue = (code: SemanticIssueCode, path: string, message: string): SemanticIssue => ({
  code,
  path,
  message,
});

function indexDecisions(decisions: readonly Decision[]): Map<string, Decision> {
  return new Map(decisions.map((decision) => [decision.id, decision]));
}

/**
 * 在单条路线内按 prerequisite_ids（AND 前提）做环检测。
 * 规格只要求「同一路线内无环」（contracts/README.md §3），跨路线不构成环，
 * 因此检测范围限定为该路线 decision_ids 形成的子图。
 */
function findRouteCycles(route: Route, decisionsById: ReadonlyMap<string, Decision>): string[][] {
  const inRoute = new Set(route.decision_ids);
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const start = trail.indexOf(id);
      cycles.push(trail.slice(start));
      return;
    }
    state.set(id, 'visiting');
    for (const prerequisite of decisionsById.get(id)?.prerequisite_ids ?? []) {
      // 只有落在本路线内的前提才参与本路线的环判定。
      if (inRoute.has(prerequisite)) visit(prerequisite, [...trail, id]);
    }
    state.set(id, 'done');
  };

  for (const id of route.decision_ids) visit(id, []);
  return cycles;
}

function checkRouteReferences(packet: Packet, decisionsById: ReadonlyMap<string, Decision>): SemanticIssue[] {
  const issues: SemanticIssue[] = [];

  for (const route of packet.routes) {
    const inRoute = new Set(route.decision_ids);

    for (const decisionId of route.decision_ids) {
      if (!decisionsById.has(decisionId)) {
        issues.push(
          issue('ROUTE_REFERENCES_UNKNOWN_DECISION', `routes.${route.id}.decision_ids`, `决策 ${decisionId} 不存在于 decisions`),
        );
      }
    }
    for (const terminalId of route.terminal_ids) {
      if (!inRoute.has(terminalId)) {
        issues.push(
          issue('ROUTE_TERMINAL_NOT_IN_ROUTE', `routes.${route.id}.terminal_ids`, `终点 ${terminalId} 不属于本路线的 decision_ids`),
        );
      }
    }
    for (const [index, decisionId] of route.decision_ids.entries()) {
      const decision = decisionsById.get(decisionId);
      if (!decision) continue;
      for (const prerequisite of decision.prerequisite_ids) {
        if (!decisionsById.has(prerequisite)) {
          issues.push(
            issue(
              'DECISION_PREREQUISITE_UNKNOWN',
              `routes.${route.id}.decision_ids.${index}`,
              `决策 ${decisionId} 的前提 ${prerequisite} 不存在于 decisions`,
            ),
          );
        }
      }
    }
    for (const cycle of findRouteCycles(route, decisionsById)) {
      issues.push(
        issue('DECISION_PREREQUISITE_CYCLE', `routes.${route.id}`, `前提依赖成环：${[...cycle, cycle[0]].join(' -> ')}`),
      );
    }
  }

  return issues;
}

/**
 * Packet 语义校验。
 *
 * ready 的四项条件见 contracts/README.md §3：「Packet.ready必须hash匹配、
 * reference_source非空、有verification记录、无blocking_issues」。其中
 * verification 非空由 Schema 的 minItems=1 保证，此处只补其余三项。
 */
export function validatePacket(packet: Packet, context: SemanticContext = {}): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const decisionsById = indexDecisions(packet.decisions);

  if (packet.ready) {
    if (packet.blocking_issues.length > 0) {
      issues.push(
        issue('PACKET_READY_WITH_BLOCKING_ISSUES', 'blocking_issues', 'ready 为真时不得存在 blocking_issues'),
      );
    }
    if (packet.reference_source.trim().length === 0) {
      issues.push(issue('PACKET_READY_WITHOUT_REFERENCE_SOURCE', 'reference_source', 'ready 为真时 reference_source 不得为空'));
    }
  }

  if (context.expectedProblemHash !== undefined && packet.problem_hash !== context.expectedProblemHash) {
    issues.push(
      issue(
        'PACKET_HASH_MISMATCH',
        'problem_hash',
        `problem_hash 与题目内容哈希不一致：期望 ${context.expectedProblemHash}，实际 ${packet.problem_hash}`,
      ),
    );
  }

  issues.push(...checkRouteReferences(packet, decisionsById));
  return issues;
}

/**
 * Strategy 语义校验。
 *
 * 「allowed_disclosures/reserved_decisions 均属于当前 task 且不相交」
 * （contracts/README.md §7）。交集判定是自洽的；「属于当前 task」需要
 * context.knownDecisionIds，缺失时跳过而非默认通过。
 */
export function validateStrategy(strategy: Strategy, context: SemanticContext = {}): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const allowed = new Set(strategy.allowed_disclosures);
  const reserved = new Set(strategy.reserved_decisions);

  const overlap = [...allowed].filter((id) => reserved.has(id));
  if (overlap.length > 0) {
    issues.push(
      issue(
        'STRATEGY_DISCLOSURE_RESERVED_OVERLAP',
        'allowed_disclosures',
        `允许披露与保留决策相交：${overlap.join(', ')}`,
      ),
    );
  }

  if (context.knownDecisionIds !== undefined) {
    const unknown = [...new Set([...allowed, ...reserved])].filter((id) => !context.knownDecisionIds?.has(id));
    if (unknown.length > 0) {
      issues.push(
        issue('STRATEGY_DISCLOSURE_UNKNOWN_DECISION', 'allowed_disclosures', `引用了当前 task 不存在的决策：${unknown.join(', ')}`),
      );
    }
  }

  return issues;
}

/** 换行归一化后做包含判定。规格只允许换行归一化，不允许其他等价化（contracts/README.md §7）。 */
function isQuotePresent(quote: string, text: string): boolean {
  if (quote.length === 0) return false;
  const normalize = (value: string) => value.replace(/\r\n/g, '\n');
  return normalize(text).includes(normalize(quote));
}

/**
 * Diagnosis 证据引用校验。
 *
 * 「EvidenceRef 必须引用当前有效 confirmed Submission 的准确 revision，
 * quote 必须能在原文本找到」（contracts/README.md §7）。缺 context 时跳过，
 * 由调用方负责保证传入可信事实——不得据此认为证据已核实。
 */
export function validateDiagnosisEvidence(diagnosis: Diagnosis, context: SemanticContext = {}): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const submissions = context.confirmedSubmissions;
  if (submissions === undefined) return issues;

  for (const [index, reference] of diagnosis.evidence_refs.entries()) {
    const path = `evidence_refs.${index}`;
    const fact = submissions.get(reference.submission_id);
    if (!fact) {
      issues.push(issue('EVIDENCE_UNKNOWN_SUBMISSION', path, `引用未确认的提交 ${reference.submission_id}`));
      continue;
    }
    if (!fact.revisions.includes(reference.revision)) {
      issues.push(
        issue('EVIDENCE_UNKNOWN_REVISION', path, `提交 ${reference.submission_id} 不存在有效 revision ${reference.revision}`),
      );
      continue;
    }
    const text = fact.textByRevision.get(reference.revision) ?? '';
    if (!isQuotePresent(reference.quote, text)) {
      issues.push(issue('EVIDENCE_QUOTE_NOT_FOUND', path, `引文无法在提交 ${reference.submission_id} 的该 revision 中找到`));
    }
  }

  return issues;
}

/**
 * Report 独立性校验。
 *
 * 公式见 contracts/README.md §8：eligible 要求 relation=near_transfer 且
 * 未求助、未曝光、未作废。AttemptReport 只承载符合条件的尝试，因此任何一项
 * 失格都不允许 independent_* 为真。数据冲突时按保守（有帮助）处理。
 */
export function validateReport(report: Report): SemanticIssue[] {
  const issues: SemanticIssue[] = [];

  for (const [index, attempt] of report.attempts.entries()) {
    const disqualifiers: string[] = [];
    if (attempt.assistance_requested) disqualifiers.push('assistance_requested');
    if (attempt.help_exposed) disqualifiers.push('help_exposed');
    if (attempt.invalidated) disqualifiers.push('invalidated');
    if (attempt.relation !== 'near_transfer') disqualifiers.push(`relation=${attempt.relation}`);

    if (disqualifiers.length === 0) continue;

    const claimed = [
      attempt.independent_planning ? 'independent_planning' : null,
      attempt.independent_execution ? 'independent_execution' : null,
      attempt.independent_task_pass ? 'independent_task_pass' : null,
    ].filter((field): field is string => field !== null);

    if (claimed.length > 0) {
      issues.push(
        issue(
          'REPORT_INDEPENDENCE_CONTRADICTION',
          `attempts.${index}`,
          `存在失格条件（${disqualifiers.join(', ')}）却声明 ${claimed.join(', ')}`,
        ),
      );
    }
  }

  return issues;
}

/**
 * 模型产出的转写草稿不得自称已确认。
 *
 * 规格（contracts/README.md §11）：visual 模型只输出 lines[{index,text,uncertain}]，
 * id/media_id/revision/confirmed 与逐行 explicitly_confirmed 全部由服务端构造，
 * 「模型返回服务端字段时拒绝」。学生确认只经 ConfirmTranscriptInput 生效。
 */
export function validateUntrustedTranscriptDraft(draft: TranscriptDraft): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (draft.confirmed) {
    issues.push(issue('TRANSCRIPT_DRAFT_SELF_CONFIRMED', 'confirmed', '模型产出或未确认的草稿不得标记 confirmed'));
  }
  return issues;
}

/**
 * 选题输入语义校验。
 *
 * 「随机默认服务端从冻结 bank manifest 所有ID均匀抽取 …… 禁止客户端自行提交
 * 候选池」（contracts/README.md §3）。因此 random 模式不得携带指定题目。
 */
export function validateSelectInput(input: SelectInput): SemanticIssue[] {
  if (input.mode === 'random' && input.problem_id !== null) {
    return [issue('SELECT_RANDOM_WITH_PROBLEM_ID', 'problem_id', 'random 模式由服务端抽取，不得指定 problem_id')];
  }
  return [];
}
