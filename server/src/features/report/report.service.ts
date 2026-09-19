import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

type Verdict = 'correct' | 'incorrect' | 'unknown' | 'unanswered';
type OriginalStatus =
  | 'in_progress'
  | 'incomplete'
  | 'unknown'
  | 'completed_with_help'
  | 'completed_without_recorded_help';

interface AttemptEvidence {
  assistanceRequested: boolean;
  execution: Verdict;
  finished: boolean;
  firstSeenEligible: boolean;
  helpExposed: boolean;
  invalidated: boolean;
  planning: Verdict;
  relation: 'near_duplicate' | 'near_transfer';
}

interface StoredAssessmentResult {
  evidence?: string[];
  execution?: Verdict;
  limitations?: string[];
  planning?: Verdict;
}

function parseJson<T>(value: unknown): T | null {
  try {
    return (typeof value === 'string' ? JSON.parse(value) : value) as T;
  } catch {
    return null;
  }
}

function isVerdict(value: unknown): value is Verdict {
  return value === 'correct'
    || value === 'incorrect'
    || value === 'unknown'
    || value === 'unanswered';
}

function unique(values: string[]) {
  return [...new Set(values)];
}

export function buildAttemptReport(input: AttemptEvidence) {
  const eligible = input.firstSeenEligible
    && input.relation === 'near_transfer'
    && !input.assistanceRequested
    && !input.helpExposed
    && !input.invalidated
    && input.finished;
  const independentPlanning = eligible && input.planning === 'correct';
  const independentExecution = eligible && input.execution === 'correct';
  const limitations: string[] = [];

  if (!input.finished) limitations.push('尚未提交最终答案，本次检验未完成。');
  if (!input.firstSeenEligible) limitations.push('任务首次展示时不满足独立资格。');
  if (input.relation !== 'near_transfer') limitations.push('该任务属于近重复练习，不能作为迁移证据。');
  if (input.assistanceRequested && !input.helpExposed) {
    limitations.push('本次请求过帮助；即使帮助尚未成功发出，也不再作为独立通过证据。');
  }
  if (input.helpExposed) limitations.push('本次实际展示过帮助，不计为独立通过。');
  if (input.invalidated) limitations.push('相关学习证据已修订，本次检验结果已作废。');
  if (input.planning === 'unknown') limitations.push('首次计划的证据不足。');
  if (input.planning === 'unanswered') limitations.push('首次计划未作答。');
  if (input.execution === 'unknown') limitations.push('最终执行的证据不足。');
  if (input.execution === 'unanswered') limitations.push('最终答案未作答。');

  return {
    independentExecution,
    independentPlanning,
    independentTaskPass: independentPlanning && independentExecution,
    limitations,
  };
}

export function deriveOriginalStatus(
  verdict: 'correct' | 'incorrect' | 'unknown' | null,
  helpExposed: boolean,
): OriginalStatus {
  if (verdict === null) return 'in_progress';
  if (verdict === 'unknown') return 'unknown';
  if (verdict === 'incorrect') return 'incomplete';
  return helpExposed ? 'completed_with_help' : 'completed_without_recorded_help';
}

@Injectable()
export class ReportService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getReport(ownerId: string, sessionId: string) {
    const session = await this.database.client
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!session) throw new NotFoundException('learning session not found');

    const [privacyState, sourceEvents] = await Promise.all([
      this.database.client
        .selectFrom('owner_privacy_state')
        .select('history_incomplete')
        .where('user_id', '=', ownerId)
        .executeTakeFirst(),
      this.database.client
        .selectFrom('events')
        .select(['event_type', 'payload_json', 'seq'])
        .where('session_id', '=', sessionId)
        .orderBy('seq', 'asc')
        .execute(),
    ]);
    const checkedEvent = [...sourceEvents]
      .reverse()
      .find((event) => event.event_type === 'current_answer_checked');
    const checkedPayload = checkedEvent
      ? parseJson<{ verdict?: unknown }>(checkedEvent.payload_json)
      : null;
    const originalVerdict = checkedPayload?.verdict === 'correct'
      || checkedPayload?.verdict === 'incorrect'
      || checkedPayload?.verdict === 'unknown'
      ? checkedPayload.verdict
      : checkedEvent ? 'unknown' : null;
    const originalHelpExposed = sourceEvents.some((event) => event.event_type === 'help_exposed');

    const reassessmentLinks = await this.database.client
      .selectFrom('events as event')
      .innerJoin('sessions as child', 'child.id', 'event.session_id')
      .select('event.session_id')
      .where('event.event_type', '=', 'assessment_reassessment_started')
      .where('event.subject_id', '=', sessionId)
      .where('child.user_id', '=', ownerId)
      .where('child.expires_at', '>', new Date())
      .orderBy('event.id', 'asc')
      .execute();
    const assessmentSessionIds = [
      sessionId,
      ...reassessmentLinks.map((event) => String(event.session_id)),
    ];

    const rows = await this.database.client
      .selectFrom('check_attempts as attempt')
      .innerJoin('assessment_tasks as task', 'task.id', 'attempt.task_id')
      .select([
        'attempt.id',
        'attempt.task_id',
        'attempt.locked_plan_markdown',
        'attempt.plan_unanswered',
        'attempt.final_answer_markdown',
        'attempt.first_seen_eligible',
        'attempt.assistance_requested',
        'attempt.help_exposed',
        'attempt.invalidated',
        'attempt.planning_result',
        'attempt.execution_result',
        'attempt.result_json',
        'attempt.finished_at',
        'task.relation',
      ])
      .where('attempt.session_id', 'in', assessmentSessionIds)
      .where('attempt.user_id', '=', ownerId)
      .orderBy('attempt.id', 'asc')
      .execute();

    const attemptIds = rows.map((row) => String(row.id));
    const helpLinks = attemptIds.length
      ? await this.database.client
          .selectFrom('events')
          .select(['session_id', 'subject_id'])
          .where('event_type', '=', 'assessment_help_session_started')
          .where('subject_id', 'in', attemptIds)
          .execute()
      : [];
    const helpSessionIds = helpLinks.map((event) => String(event.session_id));
    const helpExposureEvents = helpSessionIds.length
      ? await this.database.client
          .selectFrom('events')
          .select('session_id')
          .where('event_type', '=', 'help_exposed')
          .where('session_id', 'in', helpSessionIds)
          .execute()
      : [];
    const exposedHelpSessions = new Set(
      helpExposureEvents.map((event) => String(event.session_id)),
    );

    const observations: string[] = [];
    const attempts = rows.map((row) => {
      const stored = row.result_json
        ? parseJson<StoredAssessmentResult>(row.result_json)
        : null;
      const planning = isVerdict(row.planning_result)
        ? row.planning_result
        : isVerdict(stored?.planning)
          ? stored.planning
          : row.plan_unanswered === 1
            ? 'unanswered'
            : row.locked_plan_markdown ? 'unknown' : 'unanswered';
      const execution = isVerdict(row.execution_result)
        ? row.execution_result
        : isVerdict(stored?.execution)
          ? stored.execution
          : row.final_answer_markdown ? 'unknown' : 'unanswered';
      const linkedSessions = helpLinks
        .filter((event) => event.subject_id === String(row.id))
        .map((event) => String(event.session_id));
      const helpExposed = row.help_exposed === 1
        || linkedSessions.some((id) => exposedHelpSessions.has(id));
      const computed = buildAttemptReport({
        assistanceRequested: row.assistance_requested === 1,
        execution,
        finished: row.finished_at !== null,
        firstSeenEligible: row.first_seen_eligible === 1,
        helpExposed,
        invalidated: row.invalidated === 1,
        planning,
        relation: row.relation as 'near_duplicate' | 'near_transfer',
      });
      if (Array.isArray(stored?.evidence)) observations.push(...stored.evidence);

      return {
        assistance_requested: row.assistance_requested === 1,
        attempt_id: String(row.id),
        execution,
        help_exposed: helpExposed,
        independent_execution: computed.independentExecution,
        independent_planning: computed.independentPlanning,
        independent_task_pass: computed.independentTaskPass,
        invalidated: row.invalidated === 1,
        limitations: unique([...(stored?.limitations ?? []), ...computed.limitations]),
        planning,
        relation: row.relation as 'near_duplicate' | 'near_transfer',
        task_id: String(row.task_id),
      };
    });

    const originalStatus = deriveOriginalStatus(originalVerdict, originalHelpExposed);
    if (originalStatus === 'in_progress') observations.unshift('原题尚未提交可核对的最终结论。');
    if (originalStatus === 'unknown') observations.unshift('原题已提交核对，但现有证据不足以下数学结论。');
    if (originalStatus === 'incomplete') observations.unshift('原题当前结论仍需要修正。');
    if (originalStatus === 'completed_with_help') observations.unshift('原题当前作答有依据，并使用过教学帮助。');
    if (originalStatus === 'completed_without_recorded_help') {
      observations.unshift('原题当前作答有依据，本系统未记录教学帮助。');
    }

    return {
      attempts,
      delayed_evidence: 'not_evaluated' as const,
      limitations: [
        ...(privacyState?.history_incomplete === 1
          ? ['你删除过学习记录或有记录已过保存期；现有历史不完整，因此之后的任务不会仅凭“系统未见过”认定为首次独立证据。']
          : []),
        '报告只反映当前账号和保存期限内的记录，无法识别外部搜题或其他设备上的帮助。',
        '近迁移结果只说明本次任务表现，不等同于长期掌握或提分结论。',
      ],
      observations: unique(observations),
      original_status: originalStatus,
      session_id: String(session.id),
    };
  }
}
