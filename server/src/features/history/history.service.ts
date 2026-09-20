import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { buildAttemptReport, deriveOriginalStatus } from '../report/report.service.js';

type Verdict = 'correct' | 'incorrect' | 'unknown' | 'unanswered';
type OriginalVerdict = Exclude<Verdict, 'unanswered'> | null;
type HelpMode = 'hint' | 'explain' | 'worked_solution';

interface HistoryAttemptInput {
  assistanceRequested: boolean;
  execution: Verdict;
  finished: boolean;
  firstSeenEligible: boolean;
  helpExposed: boolean;
  invalidated: boolean;
  phase: string;
  planning: Verdict;
  relation: 'near_duplicate' | 'near_transfer';
}

interface HistoryEntryInput {
  assistanceRequested: boolean;
  attempt: HistoryAttemptInput | null;
  helpModes: string[];
  latestStudentWork: string | null;
  originalVerdict: OriginalVerdict;
  sessionId: string;
  title: string;
  topic: string;
  updatedAt: string;
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

function isHelpMode(value: unknown): value is HelpMode {
  return value === 'hint' || value === 'explain' || value === 'worked_solution';
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function buildHistoryEntry(input: HistoryEntryInput) {
  const helpModes = [...new Set(input.helpModes.filter(isHelpMode))];
  const helpExposed = helpModes.length > 0;
  const assessment = input.attempt
    ? (() => {
        const computed = buildAttemptReport({
          assistanceRequested: input.attempt.assistanceRequested,
          execution: input.attempt.execution,
          finished: input.attempt.finished,
          firstSeenEligible: input.attempt.firstSeenEligible,
          helpExposed: input.attempt.helpExposed,
          invalidated: input.attempt.invalidated,
          planning: input.attempt.planning,
          relation: input.attempt.relation,
        });
        return {
          assistance_requested: input.attempt.assistanceRequested,
          execution: input.attempt.execution,
          help_exposed: input.attempt.helpExposed,
          independent_task_pass: computed.independentTaskPass,
          invalidated: input.attempt.invalidated,
          limitations: computed.limitations,
          phase: input.attempt.phase,
          planning: input.attempt.planning,
          relation: input.attempt.relation,
        };
      })()
    : null;

  return {
    assessment,
    help: {
      exposed: helpExposed,
      modes: helpModes,
      requested: input.assistanceRequested,
    },
    latest_student_work_markdown: input.latestStudentWork,
    original_status: deriveOriginalStatus(input.originalVerdict, helpExposed),
    session_id: input.sessionId,
    title: input.title,
    topic: input.topic,
    updated_at: input.updatedAt,
  };
}

@Injectable()
export class HistoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getHistory(ownerId: string) {
    const [privacyState, sessionRows] = await Promise.all([
      this.database.client
        .selectFrom('owner_privacy_state')
        .select('history_incomplete')
        .where('user_id', '=', ownerId)
        .executeTakeFirst(),
      this.database.client
      .selectFrom('sessions')
      .select(['id', 'title', 'topic', 'db_update_time'])
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .orderBy('db_update_time', 'desc')
      .limit(60)
      .execute(),
    ]);
    const historyIncomplete = privacyState?.history_incomplete === 1;
    if (!sessionRows.length) return this.response([], historyIncomplete);

    const sessionIds = sessionRows.map((row) => String(row.id));
    const events = await this.database.client
      .selectFrom('events')
      .select(['session_id', 'seq', 'event_type', 'subject_id', 'payload_json'])
      .where('session_id', 'in', sessionIds)
      .orderBy('seq', 'asc')
      .execute();
    const reassessmentSessionLinks = new Map<string, string>();
    for (const event of events) {
      if (event.event_type !== 'assessment_reassessment_started') continue;
      reassessmentSessionLinks.set(String(event.session_id), event.subject_id);
    }

    const helpSessionLinks = new Map<string, { attemptId: string; sourceSessionId: string }>();
    for (const event of events) {
      if (event.event_type !== 'assessment_help_session_started') continue;
      const payload = parseJson<{ sourceSessionId?: unknown }>(event.payload_json);
      if (typeof payload?.sourceSessionId !== 'string') continue;
      helpSessionLinks.set(String(event.session_id), {
        attemptId: event.subject_id,
        sourceSessionId: reassessmentSessionLinks.get(payload.sourceSessionId)
          ?? payload.sourceSessionId,
      });
    }

    const latestUpdateByRoot = new Map<string, string>();
    for (const row of sessionRows) {
      const sessionId = String(row.id);
      const rootSessionId = reassessmentSessionLinks.get(sessionId) ?? sessionId;
      const updatedAt = iso(row.db_update_time);
      if ((latestUpdateByRoot.get(rootSessionId) ?? '') < updatedAt) {
        latestUpdateByRoot.set(rootSessionId, updatedAt);
      }
    }
    const mainSessions = sessionRows
      .filter((row) => {
        const sessionId = String(row.id);
        return !helpSessionLinks.has(sessionId) && !reassessmentSessionLinks.has(sessionId);
      })
      .sort((left, right) => (
        latestUpdateByRoot.get(String(right.id)) ?? iso(right.db_update_time)
      ).localeCompare(
        latestUpdateByRoot.get(String(left.id)) ?? iso(left.db_update_time),
      ))
      .slice(0, 30);
    if (!mainSessions.length) return this.response([], historyIncomplete);
    const mainSessionIds = mainSessions.map((row) => String(row.id));
    const assessmentSessionIds = [
      ...mainSessionIds,
      ...[...reassessmentSessionLinks.entries()]
        .filter(([, rootSessionId]) => mainSessionIds.includes(rootSessionId))
        .map(([childSessionId]) => childSessionId),
    ];

    const [messageRows, attemptRows] = await Promise.all([
      this.database.client
        .selectFrom('learning_messages')
        .select(['session_id', 'seq', 'content_markdown'])
        .where('session_id', 'in', mainSessionIds)
        .where('role', '=', 'student')
        .orderBy('seq', 'desc')
        .execute(),
      this.database.client
        .selectFrom('check_attempts as attempt')
        .innerJoin('assessment_tasks as task', 'task.id', 'attempt.task_id')
        .select([
          'attempt.id',
          'attempt.session_id',
          'attempt.phase',
          'attempt.locked_plan_markdown',
          'attempt.plan_unanswered',
          'attempt.final_answer_markdown',
          'attempt.first_seen_eligible',
          'attempt.assistance_requested',
          'attempt.help_exposed',
          'attempt.invalidated',
          'attempt.planning_result',
          'attempt.execution_result',
          'attempt.finished_at',
          'task.relation',
        ])
        .where('attempt.user_id', '=', ownerId)
        .where('attempt.session_id', 'in', assessmentSessionIds)
        .orderBy('attempt.id', 'asc')
        .execute(),
    ]);

    const latestWork = new Map<string, string>();
    for (const message of messageRows) {
      const sessionId = String(message.session_id);
      if (!latestWork.has(sessionId)) latestWork.set(sessionId, message.content_markdown);
    }

    const helpModes = new Map<string, HelpMode[]>();
    const exposedAttemptIds = new Set<string>();
    const originalVerdicts = new Map<string, OriginalVerdict>();
    for (const event of events) {
      const eventSessionId = String(event.session_id);
      const helpLink = helpSessionLinks.get(eventSessionId);
      const sourceSessionId = helpLink?.sourceSessionId
        ?? reassessmentSessionLinks.get(eventSessionId)
        ?? eventSessionId;
      if (event.event_type === 'help_exposed') {
        const payload = parseJson<{ assistanceMode?: unknown }>(event.payload_json);
        if (!isHelpMode(payload?.assistanceMode)) continue;
        if (helpLink) exposedAttemptIds.add(helpLink.attemptId);
        const current = helpModes.get(sourceSessionId) ?? [];
        if (!current.includes(payload.assistanceMode)) current.push(payload.assistanceMode);
        helpModes.set(sourceSessionId, current);
      }
      if (event.event_type === 'current_answer_checked' && mainSessionIds.includes(sourceSessionId)) {
        const payload = parseJson<{ verdict?: unknown }>(event.payload_json);
        originalVerdicts.set(
          sourceSessionId,
          payload?.verdict === 'correct'
            || payload?.verdict === 'incorrect'
            || payload?.verdict === 'unknown'
            ? payload.verdict
            : 'unknown',
        );
      }
    }

    const attemptBySession = new Map<string, (typeof attemptRows)[number]>();
    const assistanceRequestedBySession = new Map<string, boolean>();
    for (const row of attemptRows) {
      const attemptSessionId = String(row.session_id);
      const rootSessionId = reassessmentSessionLinks.get(attemptSessionId) ?? attemptSessionId;
      attemptBySession.set(rootSessionId, row);
      if (row.assistance_requested === 1) assistanceRequestedBySession.set(rootSessionId, true);
    }
    return this.response(mainSessions.map((session) => {
      const sessionId = String(session.id);
      const row = attemptBySession.get(sessionId);
      const attempt = row
        ? {
            assistanceRequested: row.assistance_requested === 1,
            execution: isVerdict(row.execution_result)
              ? row.execution_result
              : row.final_answer_markdown ? 'unknown' as const : 'unanswered' as const,
            finished: row.finished_at !== null,
            firstSeenEligible: row.first_seen_eligible === 1,
            helpExposed: row.help_exposed === 1 || exposedAttemptIds.has(String(row.id)),
            invalidated: row.invalidated === 1,
            phase: row.phase,
            planning: isVerdict(row.planning_result)
              ? row.planning_result
              : row.plan_unanswered === 1
                ? 'unanswered' as const
                : row.locked_plan_markdown ? 'unknown' as const : 'unanswered' as const,
            relation: row.relation as 'near_duplicate' | 'near_transfer',
          }
        : null;

      return buildHistoryEntry({
        assistanceRequested: assistanceRequestedBySession.get(sessionId) ?? false,
        attempt,
        helpModes: helpModes.get(sessionId) ?? [],
        latestStudentWork: latestWork.get(sessionId) ?? null,
        originalVerdict: originalVerdicts.get(sessionId) ?? null,
        sessionId,
        title: session.title,
        topic: session.topic,
        updatedAt: latestUpdateByRoot.get(sessionId) ?? iso(session.db_update_time),
      });
    }), historyIncomplete);
  }

  private response(
    entries: ReturnType<typeof buildHistoryEntry>[],
    historyIncomplete: boolean,
  ) {
    return {
      entries,
      retention: {
        delayed_evidence: 'not_evaluated' as const,
        history_incomplete: historyIncomplete,
        session_days: 7,
      },
    };
  }
}
