import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import type { Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import {
  ExposureSchema,
  RoutePatchSchema,
  StudentViewSchema,
  TranscriptLineSchema,
  type Diagnosis,
  type Exposure,
  type RoutePatch,
  type Strategy,
  type StudentView,
} from '../../contracts/domain.schema.js';
import type { ProblemAnalysis } from '../analysis/problem-analysis.schema.js';
import type {
  TutorNodeRecord,
  TutorTeachingState,
  TutorTurnAudit,
} from '../analysis/problem-analysis.service.js';
import type { ProblemChatMessage, ProblemChatRequest } from '../analysis/problem-chat.schema.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const RUN_DEADLINE_MS = 90_000;

type AssistanceMode = ProblemChatRequest['assistanceMode'];
type RemediationFocus = NonNullable<ProblemChatRequest['remediationFocus']>;

function isRemediationFocus(value: unknown): value is RemediationFocus {
  return value === 'method' || value === 'execution' || value === 'evidence';
}

export interface CreateLearningSessionInput {
  analysis: ProblemAnalysis;
  content: string;
  ownerId: string;
  packetVersion?: string;
  preparationStatus?: 'needs_review' | 'ready' | 'unavailable';
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
  packetVersion: string | null;
  problemMd: string;
  questionId: string | null;
  runId: string;
  teachingState: TutorTeachingState;
}

export interface ReplayedTurn {
  studentView?: StudentView;
  currentVerdict?: 'correct' | 'incorrect' | 'unknown';
  kind: 'replay';
  reply: string;
  routeAttribution?: 'student' | 'coauthored';
  version: number;
}

export type TurnReservation = ReservedTurn | ReplayedTurn;

interface ReserveTurnInput {
  /** Namespaces the B endpoint from the legacy analysis endpoint; part of the payload hash. */
  protocol?: 'tutor-v1';
  assistanceMode: AssistanceMode;
  expectedVersion: number;
  message: string;
  ownerId: string;
  requestId: string;
  remediationFocus?: RemediationFocus;
  sessionId: string;
  transcriptId?: string;
  transcriptRevision?: number;
}

interface CommitTurnInput {
  /** Safe DTO and private audit are deliberately separate; only the DTO is replayed. */
  checkedTeaching?: {
    studentView: StudentView;
    taskId: string;
    contentHash: string;
    diagnosis: Diagnosis;
    strategy: Strategy;
    canonicalProbeGoalKey: string | null;
    previousProbeCount: number;
    evidenceTranscripts: ReadonlyArray<{ transcriptId: string; transcriptRevision: number; message: string }>;
  };
  assistanceMode: AssistanceMode;
  audit?: TutorTurnAudit;
  currentVerdict?: 'correct' | 'incorrect' | 'unknown';
  leaseToken: string;
  message: string;
  ownerId: string;
  reply: string;
  requestId: string;
  remediationFocus?: RemediationFocus;
  routeAttribution?: 'student' | 'coauthored';
  routePatch?: RoutePatch;
  runId: string;
  sessionId: string;
  expectedVersion: number;
  transcriptId?: string;
  transcriptRevision?: number;
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
      protocol: input.protocol,
      expectedVersion: input.expectedVersion,
      message: input.message,
      remediationFocus: input.remediationFocus,
      sessionId: input.sessionId,
      transcriptId: input.transcriptId,
      transcriptRevision: input.transcriptRevision,
    }))
    .digest();
}

/** Rechecked inside the same short transaction that reserves/commits the turn. */
async function assertTurnTranscript(transaction: Transaction<Database>, input: Pick<CommitTurnInput, 'ownerId' | 'sessionId' | 'transcriptId' | 'transcriptRevision' | 'message'>) {
  if (Boolean(input.transcriptId) !== Boolean(input.transcriptRevision)) {
    throw new ConflictException('transcript id and revision must be supplied together');
  }
  if (!input.transcriptId) return;
  const transcript = await transaction.selectFrom('transcripts').selectAll()
    .where('id', '=', input.transcriptId).where('user_id', '=', input.ownerId).forUpdate().executeTakeFirst();
  if (!transcript || transcript.confirmed !== 1 || transcript.revision !== input.transcriptRevision
    || new Date(transcript.expires_at).getTime() <= Date.now()
    || (transcript.session_id !== null && String(transcript.session_id) !== input.sessionId)) {
    throw new ConflictException('confirmed transcript is no longer current');
  }
  const lines = TranscriptLineSchema.array().parse(parseJson<unknown>(transcript.lines_json));
  if (lines.map(line => line.text.trim()).filter(Boolean).join('\n\n') !== input.message.trim()) {
    throw new ConflictException('confirmed transcript text changed');
  }
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
  const routePatches: RoutePatch[] = [];
  const taskId = `session-${sessionId}`;
  const contentHash = problemContentHash(problemMd);

  for (const row of rows) {
    const payload = parseJson<Record<string, unknown>>(row.payload_json);
    if (row.event_type === 'diagnostic_probe_shown') {
      const goalKey = typeof payload.goalKey === 'string' ? payload.goalKey : '';
      if (goalKey) probesShownByGoal[goalKey] = (probesShownByGoal[goalKey] ?? 0) + 1;
      continue;
    }
    if (row.event_type === 'route_patch_approved') {
      const parsed = RoutePatchSchema.safeParse(payload.routePatch);
      if (parsed.success && parsed.data.task_id === taskId) routePatches.push(parsed.data);
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

  return { exposures, probesShownByGoal, routePatches };
}

export function remediationTrackAfterTurn(
  focus: RemediationFocus | undefined,
  assistanceMode: AssistanceMode,
  currentVerdict: CommitTurnInput['currentVerdict'],
): RemediationFocus | null | undefined {
  if (!focus) return undefined;
  return assistanceMode === 'finish_problem' && currentVerdict === 'correct'
    ? null
    : focus;
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
          next_event_seq: input.preparationStatus ? 2 : 1,
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

      if (input.preparationStatus) {
        await transaction
          .insertInto('events')
          .values({
            dependency_ids_json: json([]),
            event_type: 'preparation_bound',
            invalidated: 0,
            payload_json: json({
              packetVersion: input.packetVersion,
              problemHash: problemContentHash(input.problemMd),
              status: input.preparationStatus,
            }),
            seq: 1,
            session_id: sessionId,
            subject_id: input.questionId ?? sessionId,
          })
          .execute();
      }

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
    const preparationEvent = await this.database.client
      .selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', sessionId)
      .where('event_type', '=', 'preparation_bound')
      .where('invalidated', '=', 0)
      .orderBy('seq', 'desc')
      .executeTakeFirst();
    const preparationPayload = preparationEvent
      ? parseJson<{ status?: unknown }>(preparationEvent.payload_json)
      : null;
    const preparationStatus = preparationPayload?.status === 'ready'
      || preparationPayload?.status === 'needs_review'
      || preparationPayload?.status === 'unavailable'
      ? preparationPayload.status
      : undefined;
    const remediationEvent = await this.database.client
      .selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', sessionId)
      .where('event_type', '=', 'remediation_track_updated')
      .where('invalidated', '=', 0)
      .orderBy('seq', 'desc')
      .executeTakeFirst();
    const remediationPayload = remediationEvent
      ? parseJson<{ focus?: unknown }>(remediationEvent.payload_json)
      : null;
    const remediationFocus = isRemediationFocus(remediationPayload?.focus)
      ? remediationPayload.focus
      : null;
    const draft = await this.database.client
      .selectFrom('learning_drafts')
      .select('draft_markdown')
      .where('session_id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();

    return {
      analysis: parseJson<ProblemAnalysis>(session.analysis_json),
      draftMarkdown: draft?.draft_markdown ?? '',
      remediationFocus,
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
        ...(preparationStatus ? { preparationStatus } : {}),
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

  async saveDraft(ownerId: string, sessionId: string, markdown: string) {
    const savedAt = new Date();
    const session = await this.database.client
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', savedAt)
      .executeTakeFirst();
    if (!session) throw new NotFoundException('learning session not found');

    if (!markdown) {
      await this.database.client
        .deleteFrom('learning_drafts')
        .where('session_id', '=', sessionId)
        .where('user_id', '=', ownerId)
        .execute();
      return { savedAt: savedAt.toISOString() };
    }

    await this.database.client
      .insertInto('learning_drafts')
      .values({
        draft_markdown: markdown,
        expires_at: new Date(savedAt.getTime() + DRAFT_TTL_MS),
        session_id: sessionId,
        user_id: ownerId,
      })
      .onDuplicateKeyUpdate({
        draft_markdown: markdown,
        expires_at: new Date(savedAt.getTime() + DRAFT_TTL_MS),
      })
      .execute();
    return { savedAt: savedAt.toISOString() };
  }

  async updateRemediationTrack(
    ownerId: string,
    sessionId: string,
    focus: RemediationFocus | null,
  ) {
    return this.database.client.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom('sessions')
        .select(['id', 'next_event_seq'])
        .where('id', '=', sessionId)
        .where('user_id', '=', ownerId)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!session) throw new NotFoundException('learning session not found');

      await transaction
        .insertInto('events')
        .values({
          dependency_ids_json: json([]),
          event_type: 'remediation_track_updated',
          invalidated: 0,
          payload_json: json({ focus }),
          seq: session.next_event_seq,
          session_id: sessionId,
          subject_id: sessionId,
        })
        .execute();
      await transaction
        .updateTable('sessions')
        .set({ next_event_seq: session.next_event_seq + 1 })
        .where('id', '=', sessionId)
        .where('user_id', '=', ownerId)
        .executeTakeFirstOrThrow();

      return { remediationFocus: focus };
    });
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
          const response = parseJson<{
            currentVerdict?: 'correct' | 'incorrect' | 'unknown';
            studentView?: StudentView;
            reply: string;
            routeAttribution?: 'student' | 'coauthored';
            version: number;
          }>(
            existing.safe_response_json,
          );
          return { kind: 'replay', ...response };
        }
        if (existing.status === 'in_progress') {
          throw new ConflictException('request is already in progress');
        }
        if (input.protocol === 'tutor-v1') throw new ConflictException('request already failed; use a new request id');
        retryFailedRequest = true;
      }
      if (session.active_run_id) {
        throw new ConflictException('learning session already has an active request');
      }
      if (session.version !== input.expectedVersion) {
        throw new ConflictException('learning session version changed; refresh before retrying');
      }

      if (input.protocol === 'tutor-v1' && !['learning', 'study'].includes(session.phase)) {
        throw new ConflictException('teaching is not allowed in this phase');
      }
      await assertTurnTranscript(transaction, input);

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
        .where('event_type', 'in', [
          'help_exposed',
          'diagnostic_probe_shown',
          'route_patch_approved',
        ])
        .orderBy('seq', 'asc')
        .execute();
      const preparationEvent = await transaction
        .selectFrom('events')
        .select('payload_json')
        .where('session_id', '=', input.sessionId)
        .where('event_type', '=', 'preparation_bound')
        .where('invalidated', '=', 0)
        .orderBy('seq', 'desc')
        .executeTakeFirst();
      const preparationPayload = preparationEvent
        ? parseJson<{ packetVersion?: unknown; problemHash?: unknown; status?: unknown }>(
            preparationEvent.payload_json,
          )
        : null;
      const packetVersion = typeof preparationPayload?.packetVersion === 'string'
        && preparationPayload.problemHash === problemContentHash(session.problem_markdown)
        && preparationPayload.status === 'ready'
        ? preparationPayload.packetVersion
        : null;
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
          run_json: json({
            assistanceMode: input.assistanceMode,
            ...(input.protocol ? { protocol: input.protocol } : {}),
            ...(input.remediationFocus ? { remediationFocus: input.remediationFocus } : {}),
          }),
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
        packetVersion,
        problemMd: session.problem_markdown,
        questionId: session.question_id ? String(session.question_id) : null,
        runId,
        teachingState,
      };
    });
  }

  async recordTurnNode(
    input: Omit<TutorNodeRecord, 'nodeKey'> & {
      nodeKey: string;
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
        new Date(session.expires_at).getTime() <= Date.now()
        || String(run.session_id) !== input.sessionId
        || session.active_run_id !== input.runId
        || run.status !== 'active'
        || run.lease_token !== input.leaseToken
        || run.request_id !== input.requestId
        || run.reserved_version !== input.expectedVersion
        || session.version !== input.expectedVersion
        || new Date(run.deadline_at).getTime() <= Date.now()
      ) {
        throw new ConflictException('learning run lease or version is no longer valid');
      }

      // Recheck the complete handwritten context, not just the new turn. A previous
      // revision can change during an unrelated typed reply without changing session.version.
      const transcriptInputs = [input, ...(input.checkedTeaching?.evidenceTranscripts ?? []).map(reference => ({
        ownerId: input.ownerId, sessionId: input.sessionId, ...reference,
      }))].sort((a, b) => (a.transcriptId ?? '').localeCompare(b.transcriptId ?? ''));
      for (const reference of transcriptInputs) await assertTurnTranscript(transaction, reference);
      if (input.checkedTeaching) {
        const checked = input.checkedTeaching;
        const view = StudentViewSchema.parse(checked.studentView);
        if (parseJson<{protocol?:string}>(run.run_json).protocol !== 'tutor-v1'
          || !['learning', 'study'].includes(session.phase)
          || view.session_id !== input.sessionId || view.version !== input.expectedVersion + 1) {
          throw new ConflictException('checked response does not match the active turn');
        }
        if (checked.canonicalProbeGoalKey) {
          const counter = await transaction.selectFrom('probe_counters').select('shown_count')
            .where('session_id', '=', input.sessionId).where('task_id', '=', checked.taskId)
            .where('canonical_goal_key', '=', checked.canonicalProbeGoalKey).forUpdate().executeTakeFirst();
          const previousCount = Math.max(counter?.shown_count ?? 0, checked.previousProbeCount);
          if (!Number.isInteger(previousCount) || previousCount < 0 || previousCount >= 2) throw new ConflictException('diagnostic probe limit reached');
          await transaction.insertInto('probe_counters').values({session_id: input.sessionId, task_id: checked.taskId,
            canonical_goal_key: checked.canonicalProbeGoalKey, shown_count: previousCount + 1})
            .onDuplicateKeyUpdate({shown_count: previousCount + 1}).execute();
        }
      }

      const studentSeq = session.next_message_seq;
      const guideSeq = studentSeq + 1;
      const guideMetadata = {
        ...(input.assistanceMode === 'finish_problem'
          ? { currentVerdict: input.currentVerdict ?? 'unknown' }
          : {}),
        ...(input.remediationFocus ? { remediationFocus: input.remediationFocus } : {}),
        ...(input.routeAttribution ? { routeAttribution: input.routeAttribution } : {}),
      };
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
            metadata_json: input.transcriptId
              ? json({
                  source: 'handwriting',
                  transcriptId: input.transcriptId,
                  transcriptRevision: input.transcriptRevision,
                })
              : null,
          },
          {
            session_id: input.sessionId,
            request_id: input.requestId,
            seq: guideSeq,
            role: 'guide',
            message_type: 'guide_reply',
            assistance_mode: input.assistanceMode,
            content_markdown: input.reply,
            metadata_json: Object.keys(guideMetadata).length ? json(guideMetadata) : null,
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
          payload: {
            assistanceMode: input.assistanceMode,
            ...(input.remediationFocus ? { remediationFocus: input.remediationFocus } : {}),
            ...(input.transcriptId
              ? {
                  source: 'handwriting',
                  transcriptId: input.transcriptId,
                  transcriptRevision: input.transcriptRevision,
                }
              : {}),
          },
          subjectId: input.requestId,
        },
        {
          eventType: 'guide_message_committed',
          payload: {
            assistanceMode: input.assistanceMode,
            ...(input.remediationFocus ? { remediationFocus: input.remediationFocus } : {}),
            ...(input.routeAttribution ? { routeAttribution: input.routeAttribution } : {}),
          },
          subjectId: input.requestId,
        },
      ];
      const actualHelpExposed = Boolean(
        assessmentHelp
        || (!input.checkedTeaching && ['hint', 'explain', 'worked_solution'].includes(input.assistanceMode))
        || input.audit?.wholeTaskDisclosed
        || input.audit?.decisionIds.length,
      );
      if (actualHelpExposed) {
        eventFacts.push({
          eventType: 'help_exposed',
          payload: {
            assistanceMode: input.assistanceMode,
            ...(input.checkedTeaching ? { taskId: input.checkedTeaching.taskId, contentHash: input.checkedTeaching.contentHash } : {}),
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
            branches: input.audit.probe?.branches ?? [],
            focusGoalKey: input.audit.focusGoalKey,
            goalKey: input.audit.probeGoalKey,
            ...(input.checkedTeaching ? { taskId: input.checkedTeaching.taskId, canonicalGoalKey: input.checkedTeaching.canonicalProbeGoalKey } : {}),
            questionMd: input.audit.probe?.question_md ?? '',
          },
          subjectId: input.requestId,
        });
      }
      if (input.routePatch) {
        eventFacts.push({
          eventType: 'route_patch_approved',
          payload: { routePatch: input.routePatch },
          subjectId: input.requestId,
        });
      }
      if (input.checkedTeaching) {
        eventFacts.push({ eventType: 'checked_teaching_turn', subjectId: input.requestId, payload: {
          taskId: input.checkedTeaching.taskId, diagnosis: input.checkedTeaching.diagnosis, strategy: input.checkedTeaching.strategy,
        } });
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
      const nextRemediationFocus = remediationTrackAfterTurn(
        input.remediationFocus,
        input.assistanceMode,
        input.currentVerdict,
      );
      if (nextRemediationFocus !== undefined) {
        eventFacts.push({
          eventType: 'remediation_track_updated',
          payload: { focus: nextRemediationFocus },
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
      const safeResponse = {
        ...(input.checkedTeaching ? { studentView: StudentViewSchema.parse(input.checkedTeaching.studentView) } : {}),
        ...(input.assistanceMode === 'finish_problem'
          ? { currentVerdict: input.currentVerdict ?? 'unknown' }
          : {}),
        reply: input.reply,
        ...(input.routeAttribution ? { routeAttribution: input.routeAttribution } : {}),
        version,
      };
      await transaction
        .updateTable('sessions')
        .set({
          active_run_id: null,
          next_event_seq: session.next_event_seq + eventFacts.length,
          next_message_seq: guideSeq + 1,
          phase: input.checkedTeaching ? 'learning' : input.assistanceMode === 'finish_problem' ? 'answer_checked' : 'learning',
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
      await transaction
        .deleteFrom('learning_drafts')
        .where('session_id', '=', input.sessionId)
        .where('user_id', '=', input.ownerId)
        .where('draft_markdown', '=', input.message)
        .execute();

      return safeResponse;
    });
  }

  async failTurn(
    input: Pick<CommitTurnInput, 'leaseToken' | 'ownerId' | 'requestId' | 'runId' | 'sessionId'> & {
      errorCode?: string;
    },
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      // Match reserve/commit lock order: session -> run -> request. A late worker may not
      // deadlock a valid commit or clear the active run belonging to another lease.
      const session = await transaction.selectFrom('sessions').select('active_run_id')
        .where('id', '=', input.sessionId).where('user_id', '=', input.ownerId)
        .forUpdate().executeTakeFirst();
      if (!session || session.active_run_id !== input.runId) return;
      const failed = await transaction
        .updateTable('runs')
        .set({ status: 'failed' })
        .where('id', '=', input.runId)
        .where('user_id', '=', input.ownerId)
        .where('session_id', '=', input.sessionId)
        .where('request_id', '=', input.requestId)
        .where('lease_token', '=', input.leaseToken)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (Number(failed.numUpdatedRows) !== 1) return;
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
