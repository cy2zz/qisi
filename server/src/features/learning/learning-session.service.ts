import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { ExposureSchema, type Exposure } from '../../contracts/domain.schema.js';
import type { ProblemAnalysis } from '../analysis/problem-analysis.schema.js';
import type {
  TutorNodeRecord,
  TutorTeachingState,
  TutorTurnAudit,
} from '../analysis/problem-analysis.service.js';
import type { ProblemChatMessage, ProblemChatRequest } from '../analysis/problem-chat.schema.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_DEADLINE_MS = 90_000;

type AssistanceMode = ProblemChatRequest['assistanceMode'];

export interface CreateLearningSessionInput {
  analysis: ProblemAnalysis;
  content: string;
  ownerId: string;
  problemMd: string;
  questionId?: string;
  recognitionUncertain?: string[];
  title?: string;
  topic?: string;
}

export interface ReservedTurn {
  analysis: ProblemAnalysis;
  deadlineAt: string;
  expectedVersion: number;
  history: ProblemChatMessage[];
  kind: 'reserved';
  leaseToken: string;
  problemMd: string;
  runId: string;
  teachingState: TutorTeachingState;
}

export interface ReplayedTurn {
  kind: 'replay';
  reply: string;
  version: number;
}

export type TurnReservation = ReservedTurn | ReplayedTurn;

interface ReserveTurnInput {
  assistanceMode: AssistanceMode;
  expectedVersion: number;
  message: string;
  ownerId: string;
  requestId: string;
  sessionId: string;
}

interface CommitTurnInput {
  assistanceMode: AssistanceMode;
  audit?: TutorTurnAudit;
  currentVerdict?: 'correct' | 'incorrect' | 'unknown';
  leaseToken: string;
  message: string;
  ownerId: string;
  reply: string;
  requestId: string;
  runId: string;
  sessionId: string;
  expectedVersion: number;
}

interface TeachingEventRow {
  db_create_time: Date | string;
  event_type: string;
  id: string | number;
  payload_json: unknown;
  subject_id: string;
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function payloadHash(input: ReserveTurnInput) {
  return createHash('sha256')
    .update(json({
      assistanceMode: input.assistanceMode,
      expectedVersion: input.expectedVersion,
      message: input.message,
      sessionId: input.sessionId,
    }))
    .digest();
}

function problemContentHash(problemMd: string) {
  return createHash('sha256').update(problemMd).digest('hex');
}

function exposureReason(payload: Record<string, unknown>): Exposure['reason'] {
  if (payload.reason === 'worked_solution' || payload.assistanceMode === 'worked_solution') {
    return 'worked_solution';
  }
  if (payload.reason === 'teacher_trace' || payload.reason === 'route_reveal') {
    return payload.reason;
  }
  return 'teacher_hint';
}

export function restoreTutorTeachingState(
  sessionId: string,
  problemMd: string,
  rows: TeachingEventRow[],
): TutorTeachingState {
  const exposures: Exposure[] = [];
  const probesShownByGoal: Record<string, number> = {};
  const taskId = `session-${sessionId}`;
  const contentHash = problemContentHash(problemMd);

  for (const row of rows) {
    const payload = parseJson<Record<string, unknown>>(row.payload_json);
    if (row.event_type === 'diagnostic_probe_shown') {
      const goalKey = typeof payload.goalKey === 'string' ? payload.goalKey : '';
      if (goalKey) probesShownByGoal[goalKey] = (probesShownByGoal[goalKey] ?? 0) + 1;
      continue;
    }
    if (row.event_type !== 'help_exposed') continue;

    const decisionIds = Array.isArray(payload.decisionIds)
      ? payload.decisionIds.filter((value): value is string => typeof value === 'string')
      : [];
    const exposure = ExposureSchema.safeParse({
      content_hash: contentHash,
      created_at: iso(row.db_create_time),
      decision_ids: decisionIds,
      id: `event-${row.id}`,
      reason: exposureReason(payload),
      scope: payload.wholeTask === true ? 'whole_task' : 'listed_decisions',
      task_id: taskId,
      turn_id: row.subject_id,
    });
    if (exposure.success) exposures.push(exposure.data);
  }

  return { exposures, probesShownByGoal };
}

function defaultTitle(content: string, analysis: ProblemAnalysis) {
  if (/[$\\]/.test(content)) {
    const analysisTitle = analysis.overview
      .replace(/^这是一道/, '')
      .split(/[，。；：]/, 1)[0]
      ?.trim();
    if (analysisTitle) return analysisTitle.slice(0, 80);
  }

  return content
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/[$\\{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '数学题';
}

@Injectable()
export class LearningSessionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createSession(input: CreateLearningSessionInput) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const title = input.title?.trim().slice(0, 255) || defaultTitle(input.content, input.analysis);

    return this.database.client.transaction().execute(async (transaction) => {
      const inserted = await transaction
        .insertInto('sessions')
        .values({
          user_id: input.ownerId,
          question_id: input.questionId ?? null,
          title,
          topic: input.topic?.trim().slice(0, 255) ?? '',
          problem_content_markdown: input.content,
          problem_markdown: input.problemMd,
          analysis_json: json(input.analysis),
          recognition_uncertain_json: input.recognitionUncertain?.length
            ? json(input.recognitionUncertain)
            : null,
          phase: 'learning',
          version: 1,
          next_message_seq: 2,
          next_event_seq: 1,
          active_run_id: null,
          expires_at: expiresAt,
        })
        .executeTakeFirstOrThrow();
      const sessionId = String(inserted.insertId);

      await transaction
        .insertInto('learning_messages')
        .values({
          session_id: sessionId,
          request_id: null,
          seq: 1,
          role: 'guide',
          message_type: 'analysis',
          assistance_mode: null,
          content_markdown: input.analysis.overview,
          metadata_json: json({ analysis: input.analysis }),
        })
        .execute();

      return { id: sessionId, title, version: 1 };
    });
  }

  async listSessions(ownerId: string) {
    const rows = await this.database.client
      .selectFrom('sessions')
      .select([
        'id',
        'title',
        'topic',
        'problem_content_markdown',
        'problem_markdown',
        'question_id',
        'version',
        'db_update_time',
      ])
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .orderBy('db_update_time', 'desc')
      .limit(30)
      .execute();

    return rows.map((row) => ({
      content: row.problem_content_markdown,
      id: String(row.id),
      problemMd: row.problem_markdown,
      questionId: row.question_id ? String(row.question_id) : undefined,
      title: row.title,
      topic: row.topic,
      updatedAt: iso(row.db_update_time),
      version: row.version,
    }));
  }

  async getSession(ownerId: string, sessionId: string) {
    const session = await this.database.client
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!session) throw new NotFoundException('learning session not found');

    const messages = await this.database.client
      .selectFrom('learning_messages')
      .select([
        'id',
        'role',
        'message_type',
        'assistance_mode',
        'content_markdown',
        'metadata_json',
      ])
      .where('session_id', '=', sessionId)
      .orderBy('seq', 'asc')
      .execute();

    return {
      analysis: parseJson<ProblemAnalysis>(session.analysis_json),
      messages: messages.map((message) => ({
        assistanceMode: message.assistance_mode ?? undefined,
        content: message.content_markdown,
        id: String(message.id),
        messageType: message.message_type,
        metadata: message.metadata_json ? parseJson<unknown>(message.metadata_json) : undefined,
        role: message.role,
      })),
      record: {
        content: session.problem_content_markdown,
        id: String(session.id),
        problemMd: session.problem_markdown,
        questionId: session.question_id ? String(session.question_id) : undefined,
        recognitionUncertain: session.recognition_uncertain_json
          ? parseJson<string[]>(session.recognition_uncertain_json)
          : undefined,
        title: session.title,
        topic: session.topic,
        version: session.version,
      },
    };
  }

  async reserveTurn(input: ReserveTurnInput): Promise<TurnReservation> {
    const hash = payloadHash(input);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const deadlineAt = new Date(Date.now() + RUN_DEADLINE_MS);

    return this.database.client.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', input.sessionId)
        .where('user_id', '=', input.ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
        throw new NotFoundException('learning session not found');
      }

      const existing = await transaction
        .selectFrom('requests')
        .select(['payload_hash', 'status', 'safe_response_json'])
        .where('user_id', '=', input.ownerId)
        .where('request_id', '=', input.requestId)
        .executeTakeFirst();
      let retryFailedRequest = false;
      if (existing) {
        if (!Buffer.from(existing.payload_hash).equals(hash)) {
          throw new ConflictException('request id was already used with different content');
        }
        if (existing.status === 'succeeded' && existing.safe_response_json) {
          const response = parseJson<{ reply: string; version: number }>(
            existing.safe_response_json,
          );
          return { kind: 'replay', ...response };
        }
        if (existing.status === 'in_progress') {
          throw new ConflictException('request is already in progress');
        }
        retryFailedRequest = true;
      }
      if (session.active_run_id) {
        throw new ConflictException('learning session already has an active request');
      }
      if (session.version !== input.expectedVersion) {
        throw new ConflictException('learning session version changed; refresh before retrying');
      }

      const historyRows = await transaction
        .selectFrom('learning_messages')
        .select(['role', 'content_markdown'])
        .where('session_id', '=', input.sessionId)
        .where('message_type', 'in', ['student_attempt', 'guide_reply'])
        .orderBy('seq', 'desc')
        .limit(16)
        .execute();
      const history = historyRows
        .reverse()
        .filter((message): message is typeof message & { role: 'student' | 'guide' } =>
          message.role === 'student' || message.role === 'guide')
        .map((message) => ({ content: message.content_markdown, role: message.role }));
      const teachingEventRows = await transaction
        .selectFrom('events')
        .select(['id', 'subject_id', 'event_type', 'payload_json', 'db_create_time'])
        .where('session_id', '=', input.sessionId)
        .where('invalidated', '=', 0)
        .where('event_type', 'in', ['help_exposed', 'diagnostic_probe_shown'])
        .orderBy('seq', 'asc')
        .execute();
      const teachingState = restoreTutorTeachingState(
        input.sessionId,
        session.problem_markdown,
        teachingEventRows,
      );

      const runId = randomUUID();
      const leaseToken = randomBytes(32).toString('base64url');
      if (retryFailedRequest) {
        await transaction
          .updateTable('requests')
          .set({ status: 'in_progress', safe_response_json: null, error_json: null })
          .where('user_id', '=', input.ownerId)
          .where('request_id', '=', input.requestId)
          .executeTakeFirstOrThrow();
      } else {
        await transaction
          .insertInto('requests')
          .values({
            user_id: input.ownerId,
            session_id: input.sessionId,
            request_id: input.requestId,
            payload_hash: hash,
            status: 'in_progress',
            safe_response_json: null,
            error_json: null,
            expires_at: expiresAt,
          })
          .execute();
      }
      await transaction
        .insertInto('runs')
        .values({
          id: runId,
          session_id: input.sessionId,
          user_id: input.ownerId,
          request_id: input.requestId,
          workflow: 'turn',
          lease_token: leaseToken,
          fencing_token: 1,
          start_version: input.expectedVersion,
          reserved_version: input.expectedVersion,
          deadline_at: deadlineAt,
          status: 'active',
          run_json: json({ assistanceMode: input.assistanceMode }),
        })
        .execute();
      await transaction
        .updateTable('sessions')
        .set({ active_run_id: runId })
        .where('id', '=', input.sessionId)
        .where('user_id', '=', input.ownerId)
        .executeTakeFirstOrThrow();

      return {
        analysis: parseJson<ProblemAnalysis>(session.analysis_json),
        deadlineAt: deadlineAt.toISOString(),
        expectedVersion: input.expectedVersion,
        history,
        kind: 'reserved',
        leaseToken,
        problemMd: session.problem_markdown,
        runId,
        teachingState,
      };
    });
  }

  async recordTurnNode(
    input: TutorNodeRecord & {
      leaseToken: string;
      ownerId: string;
      runId: string;
    },
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      const run = await transaction
        .selectFrom('runs')
        .select(['deadline_at', 'lease_token', 'status'])
        .where('id', '=', input.runId)
        .where('user_id', '=', input.ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !run
        || run.status !== 'active'
        || run.lease_token !== input.leaseToken
        || new Date(run.deadline_at).getTime() <= Date.now()
      ) {
        throw new ConflictException('learning run lease is no longer valid');
      }

      await transaction
        .insertInto('node_runs')
        .values({
          attempt: 1,
          finished_at: new Date(input.finishedAt),
          input_hash: Buffer.from(input.inputHash, 'hex'),
          model_id: input.modelId,
          node_key: input.nodeKey,
          output_json: input.output === null ? null : json(input.output),
          prompt_version: input.promptVersion,
          run_id: input.runId,
          started_at: new Date(input.startedAt),
          status: input.status,
          usage_json: input.usage === null ? null : json(input.usage),
        })
        .execute();
    });
  }

  async commitTurn(input: CommitTurnInput) {
    return this.database.client.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', input.sessionId)
        .where('user_id', '=', input.ownerId)
        .forUpdate()
        .executeTakeFirst();
      const run = await transaction
        .selectFrom('runs')
        .selectAll()
        .where('id', '=', input.runId)
        .where('user_id', '=', input.ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (!session || !run) throw new NotFoundException('active learning run not found');
      if (
        session.active_run_id !== input.runId
        || run.status !== 'active'
        || run.lease_token !== input.leaseToken
        || run.request_id !== input.requestId
        || run.reserved_version !== input.expectedVersion
        || session.version !== input.expectedVersion
        || new Date(run.deadline_at).getTime() <= Date.now()
      ) {
        throw new ConflictException('learning run lease or version is no longer valid');
      }

      const studentSeq = session.next_message_seq;
      const guideSeq = studentSeq + 1;
      const assessmentHelp = await transaction
        .selectFrom('events')
        .select('subject_id')
        .where('session_id', '=', input.sessionId)
        .where('event_type', '=', 'assessment_help_session_started')
        .executeTakeFirst();
      await transaction
        .insertInto('learning_messages')
        .values([
          {
            session_id: input.sessionId,
            request_id: input.requestId,
            seq: studentSeq,
            role: 'student',
            message_type: 'student_attempt',
            assistance_mode: null,
            content_markdown: input.message,
            metadata_json: null,
          },
          {
            session_id: input.sessionId,
            request_id: input.requestId,
            seq: guideSeq,
            role: 'guide',
            message_type: 'guide_reply',
            assistance_mode: input.assistanceMode,
            content_markdown: input.reply,
            metadata_json: input.audit ? json({ tutorAudit: input.audit }) : null,
          },
        ])
        .execute();

      const eventFacts: Array<{
        eventType: string;
        payload: Record<string, unknown>;
        subjectId: string;
      }> = [
        {
          eventType: 'student_submitted',
          payload: { assistanceMode: input.assistanceMode },
          subjectId: input.requestId,
        },
        {
          eventType: 'guide_message_committed',
          payload: { assistanceMode: input.assistanceMode },
          subjectId: input.requestId,
        },
      ];
      const actualHelpExposed = Boolean(
        assessmentHelp
        || ['hint', 'explain', 'worked_solution'].includes(input.assistanceMode)
        || input.audit?.wholeTaskDisclosed
        || input.audit?.decisionIds.length,
      );
      if (actualHelpExposed) {
        eventFacts.push({
          eventType: 'help_exposed',
          payload: {
            assistanceMode: input.assistanceMode,
            ...(input.audit
              ? {
                  decisionIds: input.audit.decisionIds,
                  focusGoalKey: input.audit.focusGoalKey,
                  intervention: input.audit.intervention,
                  reason: input.assistanceMode === 'worked_solution'
                    ? 'worked_solution'
                    : 'teacher_hint',
                  scaffoldLevel: input.audit.scaffoldLevel,
                  wholeTask: input.audit.wholeTaskDisclosed,
                }
              : {}),
            ...(assessmentHelp ? { source: 'assessment_help_session' } : {}),
          },
          subjectId: input.requestId,
        });
      }
      if (input.audit?.probeGoalKey) {
        eventFacts.push({
          eventType: 'diagnostic_probe_shown',
          payload: {
            focusGoalKey: input.audit.focusGoalKey,
            goalKey: input.audit.probeGoalKey,
          },
          subjectId: input.requestId,
        });
      }
      if (input.assistanceMode === 'finish_problem') {
        eventFacts.push({
          eventType: 'current_answer_checked',
          payload: {
            independent: false,
            verdict: input.currentVerdict ?? 'unknown',
          },
          subjectId: input.requestId,
        });
      }
      await transaction
        .insertInto('events')
        .values(eventFacts.map((fact, index) => ({
          session_id: input.sessionId,
          seq: session.next_event_seq + index,
          event_type: fact.eventType,
          subject_id: fact.subjectId,
          dependency_ids_json: json([]),
          payload_json: json(fact.payload),
          invalidated: 0,
        })))
        .execute();

      if (assessmentHelp) {
        await transaction
          .updateTable('check_attempts')
          .set({
            help_exposed: 1,
            version: (expression) => expression('version', '+', 1),
          })
          .where('id', '=', assessmentHelp.subject_id)
          .where('user_id', '=', input.ownerId)
          .where('help_exposed', '=', 0)
          .execute();
      }

      const version = input.expectedVersion + 1;
      const safeResponse = { reply: input.reply, version };
      await transaction
        .updateTable('sessions')
        .set({
          active_run_id: null,
          next_event_seq: session.next_event_seq + eventFacts.length,
          next_message_seq: guideSeq + 1,
          phase: input.assistanceMode === 'finish_problem' ? 'answer_checked' : 'learning',
          version,
        })
        .where('id', '=', input.sessionId)
        .where('user_id', '=', input.ownerId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('requests')
        .set({ status: 'succeeded', safe_response_json: json(safeResponse), error_json: null })
        .where('user_id', '=', input.ownerId)
        .where('request_id', '=', input.requestId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('runs')
        .set({ status: 'completed' })
        .where('id', '=', input.runId)
        .where('lease_token', '=', input.leaseToken)
        .executeTakeFirstOrThrow();

      return safeResponse;
    });
  }

  async failTurn(
    input: Pick<CommitTurnInput, 'leaseToken' | 'ownerId' | 'requestId' | 'runId' | 'sessionId'> & {
      errorCode?: string;
    },
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('runs')
        .set({ status: 'failed' })
        .where('id', '=', input.runId)
        .where('user_id', '=', input.ownerId)
        .where('lease_token', '=', input.leaseToken)
        .where('status', '=', 'active')
        .execute();
      await transaction
        .updateTable('requests')
        .set({
          status: 'failed',
          error_json: json({ code: input.errorCode ?? 'MODEL_OR_GUARD_FAILED' }),
        })
        .where('user_id', '=', input.ownerId)
        .where('request_id', '=', input.requestId)
        .where('status', '=', 'in_progress')
        .execute();
      await transaction
        .updateTable('sessions')
        .set({ active_run_id: null })
        .where('id', '=', input.sessionId)
        .where('user_id', '=', input.ownerId)
        .where('active_run_id', '=', input.runId)
        .execute();
    });
  }
}
