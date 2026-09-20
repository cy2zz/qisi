import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import { PacketSchema, type CheckTask } from '../../contracts/domain.schema.js';
import type { Database } from '../../database/database.types.js';
import { DatabaseService } from '../../database/database.service.js';
import { workflowBudget, type WorkflowName } from '../../workflows/runtime.js';
import type { AssessmentGrade, AssessmentTaskCandidate } from './assessment.schema.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function json(value: unknown) {
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export interface GeneratedAssessmentTask {
  candidate: AssessmentTaskCandidate;
  taskHash: Buffer;
  verification: unknown;
}

export interface AssessmentAttemptRecord {
  answerDraftMarkdown: string;
  assistanceRequested: boolean;
  equivalenceGroup: string;
  finalAnswerMarkdown: string | null;
  firstSeenEligible: boolean;
  helpExposed: boolean;
  helpSessionId: string | null;
  id: string;
  invalidated: boolean;
  lockedPlanMarkdown: string | null;
  phase: string;
  planDraftMarkdown: string;
  planUnanswered: boolean;
  promptMarkdown: string;
  referenceAnswerMarkdown: string;
  relation: 'near_duplicate' | 'near_transfer';
  result: AssessmentResult | null;
  rubric: string[];
  sessionId: string;
  taskId: string;
  version: number;
}

export interface AssessmentResult extends AssessmentGrade {
  independentExecution: boolean;
  independentPlanning: boolean;
  independentTaskPass: boolean;
  limitations: string[];
}

export interface AssessmentModelRun {
  deadlineAt: string;
  leaseToken: string;
  requestId: string;
  runId: string;
}

export interface AssessmentModelNodeRecord {
  finishedAt: string;
  inputHash: string;
  modelId: string;
  nodeKey: string;
  output: unknown | null;
  promptVersion: string;
  startedAt: string;
  status: 'completed' | 'failed';
  usage: {
    elapsedMs: number;
    input: number;
    kind: 'estimated' | 'reported' | 'unknown';
    output: number;
    provider: string;
    providerRequestId?: string;
  } | null;
}

@Injectable()
export class AssessmentRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async startModelRun(
    ownerId: string,
    sessionId: string,
    workflow: Extract<WorkflowName, 'grade' | 'prepare'>,
    context: Record<string, unknown>,
  ): Promise<AssessmentModelRun> {
    const requestId = randomUUID();
    const runId = randomUUID();
    const leaseToken = randomBytes(32).toString('base64url');
    const deadlineAt = new Date(Date.now() + workflowBudget(workflow).deadline_ms);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ context, sessionId, workflow }), 'utf8')
      .digest();

    await this.database.client.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom('sessions')
        .select('version')
        .where('id', '=', sessionId)
        .where('user_id', '=', ownerId)
        .where('expires_at', '>', new Date())
        .executeTakeFirst();
      if (!session) throw new NotFoundException('learning session not found');

      await transaction
        .insertInto('requests')
        .values({
          error_json: null,
          expires_at: expiresAt,
          payload_hash: payloadHash,
          request_id: requestId,
          safe_response_json: null,
          session_id: sessionId,
          status: 'in_progress',
          user_id: ownerId,
        })
        .execute();
      await transaction
        .insertInto('runs')
        .values({
          deadline_at: deadlineAt,
          fencing_token: 1,
          id: runId,
          lease_token: leaseToken,
          request_id: requestId,
          reserved_version: session.version,
          run_json: json({ ...context, auditOnly: true }),
          session_id: sessionId,
          start_version: session.version,
          status: 'active',
          user_id: ownerId,
          workflow,
        })
        .execute();
    });

    return { deadlineAt: deadlineAt.toISOString(), leaseToken, requestId, runId };
  }

  async recordModelNode(
    ownerId: string,
    run: AssessmentModelRun,
    record: AssessmentModelNodeRecord,
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      const active = await transaction
        .selectFrom('runs')
        .select(['deadline_at', 'lease_token', 'status'])
        .where('id', '=', run.runId)
        .where('user_id', '=', ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !active
        || active.status !== 'active'
        || active.lease_token !== run.leaseToken
        || new Date(active.deadline_at).getTime() <= Date.now()
      ) {
        throw new ConflictException('assessment model run lease is no longer valid');
      }

      await transaction
        .insertInto('node_runs')
        .values({
          attempt: 1,
          finished_at: new Date(record.finishedAt),
          input_hash: Buffer.from(record.inputHash, 'hex'),
          model_id: record.modelId,
          node_key: record.nodeKey,
          output_json: record.output === null ? null : json(record.output),
          prompt_version: record.promptVersion,
          run_id: run.runId,
          started_at: new Date(record.startedAt),
          status: record.status,
          usage_json: record.usage === null ? null : json(record.usage),
        })
        .execute();
    });
  }

  async completeModelRun(
    ownerId: string,
    run: AssessmentModelRun,
    status: 'completed' | 'failed',
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      const updated = await transaction
        .updateTable('runs')
        .set({ status })
        .where('id', '=', run.runId)
        .where('user_id', '=', ownerId)
        .where('lease_token', '=', run.leaseToken)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) {
        throw new ConflictException('assessment model run is no longer active');
      }
      await transaction
        .updateTable('requests')
        .set(status === 'completed'
          ? { error_json: null, safe_response_json: json({ auditOnly: true }), status: 'succeeded' }
          : { error_json: json({ code: 'ASSESSMENT_MODEL_RUN_FAILED' }), status: 'failed' })
        .where('user_id', '=', ownerId)
        .where('request_id', '=', run.requestId)
        .where('status', '=', 'in_progress')
        .executeTakeFirstOrThrow();
    });
  }

  async getSourceSession(ownerId: string, sessionId: string) {
    const session = await this.database.client
      .selectFrom('sessions')
      .select(['analysis_json', 'problem_markdown', 'question_id'])
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!session) throw new NotFoundException('learning session not found');

    const [preparationEvent, checkedEvent] = await Promise.all([
      this.database.client
        .selectFrom('events')
        .select('payload_json')
        .where('session_id', '=', sessionId)
        .where('event_type', '=', 'preparation_bound')
        .where('invalidated', '=', 0)
        .orderBy('seq', 'desc')
        .executeTakeFirst(),
      this.database.client
        .selectFrom('events')
        .select('payload_json')
        .where('session_id', '=', sessionId)
        .where('event_type', '=', 'current_answer_checked')
        .where('invalidated', '=', 0)
        .orderBy('seq', 'desc')
        .executeTakeFirst(),
    ]);
    const checkedPayload = checkedEvent
      ? parseJson<{ verdict?: unknown }>(checkedEvent.payload_json)
      : null;
    const currentAnswerVerdict = checkedPayload?.verdict === 'correct'
      || checkedPayload?.verdict === 'incorrect'
      || checkedPayload?.verdict === 'unknown'
      ? checkedPayload.verdict
      : checkedEvent ? 'unknown' : null;
    let preparedCheckTasks: CheckTask[] = [];
    let preparedPacketVersion: string | null = null;
    if (preparationEvent) {
      const binding = parseJson<{
        packetVersion?: unknown;
        problemHash?: unknown;
        status?: unknown;
      }>(preparationEvent.payload_json);
      if (
        binding.status === 'ready'
        && typeof binding.packetVersion === 'string'
        && typeof binding.problemHash === 'string'
        && /^[0-9a-f]{64}$/.test(binding.problemHash)
      ) {
        const packetRow = await this.database.client
          .selectFrom('packets')
          .select(['packet_json', 'status'])
          .where('problem_hash', '=', Buffer.from(binding.problemHash, 'hex'))
          .where('version', '=', binding.packetVersion)
          .where('status', '=', 'ready')
          .executeTakeFirst();
        const parsedPacket = packetRow
          ? PacketSchema.safeParse(parseJson(packetRow.packet_json))
          : null;
        if (
          parsedPacket?.success
          && parsedPacket.data.ready
          && parsedPacket.data.problem_hash === binding.problemHash
          && parsedPacket.data.version === binding.packetVersion
          && (!session.question_id || parsedPacket.data.problem_id === String(session.question_id))
        ) {
          preparedCheckTasks = parsedPacket.data.check_tasks.filter(
            (task) => task.source_problem_id === parsedPacket.data.problem_id,
          );
          preparedPacketVersion = binding.packetVersion;
        }
      }
    }

    return {
      analysis: parseJson<{
        keyConditions: string[];
        knowledgePoints: string[];
        overview: string;
        target: string;
      }>(session.analysis_json),
      currentAnswerVerdict,
      preparedCheckTasks,
      preparedPacketVersion,
      problemMarkdown: session.problem_markdown,
      questionId: session.question_id ? String(session.question_id) : null,
    };
  }

  async getCurrentAttempt(ownerId: string, sessionId: string) {
    await this.assertOwnedSession(ownerId, sessionId);
    const reassessmentSessionId = await this.getLatestReassessmentSessionId(ownerId, sessionId);
    const attempt = await this.database.client
      .selectFrom('check_attempts')
      .select('id')
      .where('session_id', '=', reassessmentSessionId ?? sessionId)
      .where('user_id', '=', ownerId)
      .executeTakeFirst();
    if (!attempt) throw new NotFoundException('assessment attempt not found');
    return this.getAttempt(ownerId, String(attempt.id));
  }

  async getActiveReassessment(ownerId: string, rootSessionId: string) {
    await this.assertOwnedSession(ownerId, rootSessionId);
    const reassessmentSessionId = await this.getLatestReassessmentSessionId(
      ownerId,
      rootSessionId,
    );
    if (!reassessmentSessionId) return null;
    const attempt = await this.database.client
      .selectFrom('check_attempts')
      .select(['id', 'phase'])
      .where('session_id', '=', reassessmentSessionId)
      .where('user_id', '=', ownerId)
      .executeTakeFirst();
    if (!attempt || attempt.phase === 'summary') return null;
    return this.getAttempt(ownerId, String(attempt.id));
  }

  async getReassessmentHistory(ownerId: string, rootSessionId: string) {
    await this.assertOwnedSession(ownerId, rootSessionId);
    const reassessmentSessionIds = await this.getReassessmentSessionIds(ownerId, rootSessionId);
    const rows = await this.database.client
      .selectFrom('check_attempts as attempt')
      .innerJoin('assessment_tasks as task', 'task.id', 'attempt.task_id')
      .select(['task.equivalence_group', 'task.prompt_markdown'])
      .where('attempt.user_id', '=', ownerId)
      .where('attempt.session_id', 'in', [rootSessionId, ...reassessmentSessionIds])
      .orderBy('attempt.id', 'asc')
      .execute();
    return rows.map((row) => ({
      equivalenceGroup: row.equivalence_group,
      promptMarkdown: row.prompt_markdown,
    }));
  }

  async isTaskSeen(ownerId: string, taskHash: Buffer, equivalenceGroup: string) {
    const [exact, equivalent] = await Promise.all([
      this.database.client
        .selectFrom('seen_tasks')
        .select('id')
        .where('user_id', '=', ownerId)
        .where('task_hash', '=', taskHash)
        .executeTakeFirst(),
      this.database.client
        .selectFrom('seen_tasks')
        .select('id')
        .where('user_id', '=', ownerId)
        .where('equivalence_group', '=', equivalenceGroup)
        .executeTakeFirst(),
    ]);
    return Boolean(exact || equivalent);
  }

  async createAttempt(
    ownerId: string,
    sessionId: string,
    generated: GeneratedAssessmentTask,
  ) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const now = new Date();

    const attemptId = await this.database.client.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom('sessions')
        .select(['id', 'question_id'])
        .where('id', '=', sessionId)
        .where('user_id', '=', ownerId)
        .where('expires_at', '>', now)
        .forUpdate()
        .executeTakeFirst();
      if (!session) throw new NotFoundException('learning session not found');

      const existingAttempt = await transaction
        .selectFrom('check_attempts')
        .select('id')
        .where('session_id', '=', sessionId)
        .where('user_id', '=', ownerId)
        .executeTakeFirst();
      if (existingAttempt) return String(existingAttempt.id);

      const checkedEvent = await transaction
        .selectFrom('events')
        .select('payload_json')
        .where('session_id', '=', sessionId)
        .where('event_type', '=', 'current_answer_checked')
        .where('invalidated', '=', 0)
        .orderBy('seq', 'desc')
        .executeTakeFirst();
      const checkedPayload = checkedEvent
        ? parseJson<{ verdict?: unknown }>(checkedEvent.payload_json)
        : null;
      if (checkedPayload?.verdict !== 'correct') {
        throw new ConflictException({
          code: 'ORIGINAL_ANSWER_NOT_READY',
          message: '请先完成原题核对并修正当前答案，再开始独立检验。',
        });
      }
      return this.insertTaskAndAttempt(
        transaction,
        ownerId,
        sessionId,
        session.question_id ? String(session.question_id) : null,
        generated,
        now,
        expiresAt,
      );
    });

    return this.getAttempt(ownerId, attemptId);
  }

  async createReassessment(
    ownerId: string,
    rootSessionId: string,
    generated: GeneratedAssessmentTask,
  ) {
    const now = new Date();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const attemptId = await this.database.client.transaction().execute(async (transaction) => {
      const root = await transaction
        .selectFrom('sessions')
        .select([
          'analysis_json',
          'id',
          'problem_content_markdown',
          'problem_markdown',
          'question_id',
          'recognition_uncertain_json',
          'title',
          'topic',
        ])
        .where('id', '=', rootSessionId)
        .where('user_id', '=', ownerId)
        .where('expires_at', '>', now)
        .forUpdate()
        .executeTakeFirst();
      if (!root) throw new NotFoundException('learning session not found');

      const linked = await transaction
        .selectFrom('events as event')
        .innerJoin('sessions as linked_session', 'linked_session.id', 'event.session_id')
        .innerJoin('check_attempts as linked_attempt', 'linked_attempt.session_id', 'event.session_id')
        .select(['linked_attempt.id', 'linked_attempt.phase'])
        .where('event.event_type', '=', 'assessment_reassessment_started')
        .where('event.subject_id', '=', rootSessionId)
        .where('linked_session.user_id', '=', ownerId)
        .orderBy('event.id', 'desc')
        .executeTakeFirst();
      if (linked && linked.phase !== 'summary') return String(linked.id);

      const previousAttempt = linked ?? await transaction
        .selectFrom('check_attempts')
        .select(['id', 'phase'])
        .where('session_id', '=', rootSessionId)
        .where('user_id', '=', ownerId)
        .executeTakeFirst();
      if (!previousAttempt || previousAttempt.phase !== 'summary') {
        throw new ConflictException('current assessment is not complete');
      }

      const child = await transaction
        .insertInto('sessions')
        .values({
          active_run_id: null,
          analysis_json: json(parseJson(root.analysis_json)),
          expires_at: expiresAt,
          next_event_seq: 2,
          next_message_seq: 1,
          phase: 'check_plan',
          problem_content_markdown: generated.candidate.promptMarkdown,
          problem_markdown: generated.candidate.promptMarkdown,
          question_id: null,
          recognition_uncertain_json: null,
          title: `${root.title} · 再测`,
          topic: root.topic,
          user_id: ownerId,
          version: 1,
        })
        .executeTakeFirstOrThrow();
      const childSessionId = String(child.insertId);

      await transaction
        .insertInto('events')
        .values({
          dependency_ids_json: json([String(previousAttempt.id)]),
          event_type: 'assessment_reassessment_started',
          invalidated: 0,
          payload_json: json({
            previousAttemptId: String(previousAttempt.id),
            rootSessionId,
          }),
          seq: 1,
          session_id: childSessionId,
          subject_id: rootSessionId,
        })
        .execute();

      return this.insertTaskAndAttempt(
        transaction,
        ownerId,
        childSessionId,
        root.question_id ? String(root.question_id) : null,
        generated,
        now,
        expiresAt,
      );
    });
    return this.getAttempt(ownerId, attemptId);
  }

  async saveDraft(
    ownerId: string,
    attemptId: string,
    input: { expectedVersion: number; kind: 'answer' | 'plan'; markdown: string },
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, ownerId, attemptId);
      this.assertVersion(attempt.version, input.expectedVersion);
      if (input.kind === 'plan' && attempt.phase !== 'check_plan') {
        throw new ConflictException('plan is already locked');
      }
      if (input.kind === 'answer' && attempt.phase !== 'check_answer') {
        throw new ConflictException('answer cannot be edited in the current phase');
      }

      await transaction
        .updateTable('check_attempts')
        .set({
          ...(input.kind === 'plan'
            ? { plan_draft_markdown: input.markdown }
            : { answer_draft_markdown: input.markdown }),
          version: attempt.version + 1,
        })
        .where('id', '=', attemptId)
        .executeTakeFirstOrThrow();
    });
    return this.getAttempt(ownerId, attemptId);
  }

  async lockPlan(
    ownerId: string,
    attemptId: string,
    input: {
      expectedVersion: number;
      noPlan: boolean;
      planMarkdown: string;
      transcriptId?: string;
      transcriptRevision?: number;
    },
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, ownerId, attemptId);
      this.assertVersion(attempt.version, input.expectedVersion);
      if (attempt.phase !== 'check_plan') throw new ConflictException('plan is already locked');

      await transaction
        .updateTable('check_attempts')
        .set({
          phase: 'check_answer',
          plan_draft_markdown: input.planMarkdown,
          locked_plan_markdown: input.noPlan ? '' : input.planMarkdown,
          plan_unanswered: input.noPlan ? 1 : 0,
          plan_locked_at: new Date(),
          version: attempt.version + 1,
        })
        .where('id', '=', attemptId)
        .executeTakeFirstOrThrow();

      await this.appendHandwritingSource(
        transaction,
        ownerId,
        attemptId,
        String(attempt.session_id),
        'plan',
        input.transcriptId,
        input.transcriptRevision,
      );

      await transaction
        .updateTable('sessions')
        .set({ phase: 'check_answer', version: (expression) => expression('version', '+', 1) })
        .where('id', '=', attempt.session_id)
        .executeTakeFirstOrThrow();
    });
    return this.getAttempt(ownerId, attemptId);
  }

  async freezeAnswer(
    ownerId: string,
    attemptId: string,
    input: {
      answerMarkdown: string;
      expectedVersion: number;
      transcriptId?: string;
      transcriptRevision?: number;
    },
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, ownerId, attemptId);
      if (attempt.phase === 'grading' || attempt.phase === 'summary') {
        if (attempt.final_answer_markdown === input.answerMarkdown) return;
        throw new ConflictException('final answer is already frozen');
      }
      this.assertVersion(attempt.version, input.expectedVersion);
      if (attempt.phase !== 'check_answer') throw new ConflictException('answer cannot be submitted');

      await transaction
        .updateTable('check_attempts')
        .set({
          answer_draft_markdown: input.answerMarkdown,
          final_answer_markdown: input.answerMarkdown,
          phase: 'grading',
          finished_at: new Date(),
          version: attempt.version + 1,
        })
        .where('id', '=', attemptId)
        .executeTakeFirstOrThrow();

      await this.appendHandwritingSource(
        transaction,
        ownerId,
        attemptId,
        String(attempt.session_id),
        'answer',
        input.transcriptId,
        input.transcriptRevision,
      );
      await transaction
        .updateTable('sessions')
        .set({ phase: 'grading', version: (expression) => expression('version', '+', 1) })
        .where('id', '=', attempt.session_id)
        .executeTakeFirstOrThrow();
    });
    return this.getAttempt(ownerId, attemptId);
  }

  async saveGrade(ownerId: string, attemptId: string, result: AssessmentResult) {
    await this.database.client.transaction().execute(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, ownerId, attemptId);
      if (attempt.phase === 'summary') return;
      if (attempt.phase !== 'grading') throw new ConflictException('attempt is not grading');

      await transaction
        .updateTable('check_attempts')
        .set({
          execution_result: result.execution,
          phase: 'summary',
          planning_result: result.planning,
          result_json: json(result),
          version: attempt.version + 1,
        })
        .where('id', '=', attemptId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('sessions')
        .set({ phase: 'summary', version: (expression) => expression('version', '+', 1) })
        .where('id', '=', attempt.session_id)
        .executeTakeFirstOrThrow();
    });
    return this.getAttempt(ownerId, attemptId);
  }

  async requestHelp(
    ownerId: string,
    attemptId: string,
    input: { currentMarkdown: string; expectedVersion: number },
  ) {
    await this.database.client.transaction().execute(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, ownerId, attemptId);
      this.assertVersion(attempt.version, input.expectedVersion);
      if (attempt.phase !== 'check_plan' && attempt.phase !== 'check_answer') {
        throw new ConflictException('help cannot be requested in the current phase');
      }

      const task = await transaction
        .selectFrom('assessment_tasks')
        .select(['prompt_markdown'])
        .where('id', '=', attempt.task_id)
        .where('user_id', '=', ownerId)
        .executeTakeFirst();
      if (!task) throw new NotFoundException('assessment task not found');

      const helpAnalysis = {
        firstQuestion: '先指出你卡住的位置，或在下方选择需要的帮助深度。',
        keyConditions: [],
        knowledgePoints: [],
        overview: '已转入同题教学。检验中的草稿已保留；在你选择帮助方式前，不会自动展示解法。',
        target: '解决这道检验题中的当前卡点',
      };
      const helpSession = await transaction
        .insertInto('sessions')
        .values({
          active_run_id: null,
          analysis_json: json(helpAnalysis),
          expires_at: new Date(Date.now() + SESSION_TTL_MS),
          next_event_seq: 2,
          next_message_seq: 3,
          phase: 'learning',
          problem_content_markdown: task.prompt_markdown,
          problem_markdown: task.prompt_markdown,
          question_id: null,
          recognition_uncertain_json: null,
          title: '独立检验题 · 同题教学',
          topic: '独立检验求助',
          user_id: ownerId,
          version: 1,
        })
        .executeTakeFirstOrThrow();
      const helpSessionId = String(helpSession.insertId);

      await transaction
        .insertInto('learning_messages')
        .values([
          {
            assistance_mode: null,
            content_markdown: helpAnalysis.overview,
            message_type: 'analysis',
            metadata_json: json({ analysis: helpAnalysis }),
            request_id: null,
            role: 'guide',
            seq: 1,
            session_id: helpSessionId,
          },
          {
            assistance_mode: null,
            content_markdown: input.currentMarkdown.trim() || '我需要帮助。',
            message_type: 'assessment_help_request',
            metadata_json: json({ sourceAttemptId: attemptId }),
            request_id: null,
            role: 'student',
            seq: 2,
            session_id: helpSessionId,
          },
        ])
        .execute();
      await transaction
        .insertInto('events')
        .values({
          dependency_ids_json: json([]),
          event_type: 'assessment_help_session_started',
          invalidated: 0,
          payload_json: json({ sourceSessionId: String(attempt.session_id) }),
          seq: 1,
          session_id: helpSessionId,
          subject_id: attemptId,
        })
        .execute();

      await transaction
        .updateTable('check_attempts')
        .set({
          ...(attempt.phase === 'check_plan'
            ? { plan_draft_markdown: input.currentMarkdown }
            : { answer_draft_markdown: input.currentMarkdown }),
          assistance_requested: 1,
          phase: 'help_requested',
          version: attempt.version + 1,
        })
        .where('id', '=', attemptId)
        .executeTakeFirstOrThrow();
    });
    return this.getAttempt(ownerId, attemptId);
  }

  private async assertOwnedSession(ownerId: string, sessionId: string) {
    const session = await this.database.client
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!session) throw new NotFoundException('learning session not found');
  }

  private async getReassessmentSessionIds(ownerId: string, rootSessionId: string) {
    const rows = await this.database.client
      .selectFrom('events as event')
      .innerJoin('sessions as session', 'session.id', 'event.session_id')
      .select('event.session_id')
      .where('event.event_type', '=', 'assessment_reassessment_started')
      .where('event.subject_id', '=', rootSessionId)
      .where('session.user_id', '=', ownerId)
      .where('session.expires_at', '>', new Date())
      .orderBy('event.id', 'asc')
      .execute();
    return rows.map((row) => String(row.session_id));
  }

  private async getLatestReassessmentSessionId(ownerId: string, rootSessionId: string) {
    const ids = await this.getReassessmentSessionIds(ownerId, rootSessionId);
    return ids.at(-1) ?? null;
  }

  private async insertTaskAndAttempt(
    transaction: Transaction<Database>,
    ownerId: string,
    sessionId: string,
    sourceQuestionId: string | null,
    generated: GeneratedAssessmentTask,
    now: Date,
    expiresAt: Date,
  ) {
    const [exactSeen, equivalentSeen, privacyState] = await Promise.all([
      transaction
        .selectFrom('seen_tasks')
        .select('id')
        .where('user_id', '=', ownerId)
        .where('task_hash', '=', generated.taskHash)
        .executeTakeFirst(),
      transaction
        .selectFrom('seen_tasks')
        .select('id')
        .where('user_id', '=', ownerId)
        .where('equivalence_group', '=', generated.candidate.equivalenceGroup)
        .executeTakeFirst(),
      transaction
        .selectFrom('owner_privacy_state')
        .select('history_incomplete')
        .where('user_id', '=', ownerId)
        .executeTakeFirst(),
    ]);
    if (exactSeen || equivalentSeen) {
      throw new ConflictException('assessment task was already seen');
    }

    const task = await transaction
      .insertInto('assessment_tasks')
      .values({
        equivalence_group: generated.candidate.equivalenceGroup,
        expires_at: expiresAt,
        prompt_markdown: generated.candidate.promptMarkdown,
        reference_answer_markdown: generated.candidate.referenceAnswerMarkdown,
        relation: generated.candidate.relation,
        rubric_json: json(generated.candidate.rubric),
        source_question_id: sourceQuestionId,
        source_session_id: sessionId,
        status: 'verified',
        task_hash: generated.taskHash,
        user_id: ownerId,
        verification_json: json(generated.verification),
      })
      .executeTakeFirstOrThrow();
    const taskId = String(task.insertId);
    const firstSeenEligible = generated.candidate.relation === 'near_transfer'
      && privacyState?.history_incomplete !== 1;

    await transaction
      .insertInto('seen_tasks')
      .values({
        equivalence_group: generated.candidate.equivalenceGroup,
        first_seen_at: now,
        first_seen_eligible: firstSeenEligible ? 1 : 0,
        task_hash: generated.taskHash,
        task_id: taskId,
        user_id: ownerId,
      })
      .execute();

    const attempt = await transaction
      .insertInto('check_attempts')
      .values({
        answer_draft_markdown: '',
        assistance_requested: 0,
        execution_result: null,
        final_answer_markdown: null,
        finished_at: null,
        first_seen_eligible: firstSeenEligible ? 1 : 0,
        help_exposed: 0,
        invalidated: 0,
        locked_plan_markdown: null,
        phase: 'check_plan',
        plan_draft_markdown: '',
        plan_locked_at: null,
        plan_unanswered: 0,
        planning_result: null,
        result_json: null,
        session_id: sessionId,
        started_at: now,
        task_id: taskId,
        user_id: ownerId,
        version: 1,
      })
      .executeTakeFirstOrThrow();

    await transaction
      .updateTable('sessions')
      .set({ phase: 'check_plan', version: (expression) => expression('version', '+', 1) })
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow();
    return String(attempt.insertId);
  }

  private async getAttempt(ownerId: string, attemptId: string): Promise<AssessmentAttemptRecord> {
    const row = await this.database.client
      .selectFrom('check_attempts as attempt')
      .innerJoin('assessment_tasks as task', 'task.id', 'attempt.task_id')
      .select([
        'attempt.id',
        'attempt.session_id',
        'attempt.task_id',
        'attempt.phase',
        'attempt.plan_draft_markdown',
        'attempt.locked_plan_markdown',
        'attempt.plan_unanswered',
        'attempt.answer_draft_markdown',
        'attempt.final_answer_markdown',
        'attempt.first_seen_eligible',
        'attempt.assistance_requested',
        'attempt.help_exposed',
        'attempt.invalidated',
        'attempt.result_json',
        'attempt.version',
        'task.prompt_markdown',
        'task.reference_answer_markdown',
        'task.rubric_json',
        'task.relation',
        'task.equivalence_group',
      ])
      .where('attempt.id', '=', attemptId)
      .where('attempt.user_id', '=', ownerId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('assessment attempt not found');

    const helpSession = await this.database.client
      .selectFrom('events')
      .select('session_id')
      .where('event_type', '=', 'assessment_help_session_started')
      .where('subject_id', '=', attemptId)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    return {
      answerDraftMarkdown: row.answer_draft_markdown,
      assistanceRequested: row.assistance_requested === 1,
      equivalenceGroup: row.equivalence_group,
      finalAnswerMarkdown: row.final_answer_markdown,
      firstSeenEligible: row.first_seen_eligible === 1,
      helpExposed: row.help_exposed === 1,
      helpSessionId: helpSession ? String(helpSession.session_id) : null,
      id: String(row.id),
      invalidated: row.invalidated === 1,
      lockedPlanMarkdown: row.locked_plan_markdown,
      phase: row.phase,
      planDraftMarkdown: row.plan_draft_markdown,
      planUnanswered: row.plan_unanswered === 1,
      promptMarkdown: row.prompt_markdown,
      referenceAnswerMarkdown: row.reference_answer_markdown,
      relation: row.relation as 'near_duplicate' | 'near_transfer',
      result: row.result_json ? parseJson<AssessmentResult>(row.result_json) : null,
      rubric: parseJson<string[]>(row.rubric_json),
      sessionId: String(row.session_id),
      taskId: String(row.task_id),
      version: row.version,
    };
  }

  private async lockAttempt(
    transaction: Transaction<Database>,
    ownerId: string,
    attemptId: string,
  ) {
    const attempt = await transaction
      .selectFrom('check_attempts')
      .select(['final_answer_markdown', 'id', 'phase', 'session_id', 'task_id', 'version'])
      .where('id', '=', attemptId)
      .where('user_id', '=', ownerId)
      .forUpdate()
      .executeTakeFirst();
    if (!attempt) throw new NotFoundException('assessment attempt not found');
    return attempt;
  }

  private async appendHandwritingSource(
    transaction: Transaction<Database>,
    ownerId: string,
    attemptId: string,
    sessionId: string,
    kind: 'answer' | 'plan',
    transcriptId?: string,
    transcriptRevision?: number,
  ) {
    if (Boolean(transcriptId) !== Boolean(transcriptRevision)) {
      throw new ConflictException('handwriting binding is incomplete');
    }
    if (!transcriptId || !transcriptRevision) return;

    const session = await transaction
      .selectFrom('sessions')
      .select('next_event_seq')
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .forUpdate()
      .executeTakeFirst();
    if (!session) throw new NotFoundException('learning session not found');

    await transaction
      .insertInto('events')
      .values({
        dependency_ids_json: json([]),
        event_type: 'assessment_handwriting_submitted',
        invalidated: 0,
        payload_json: json({ kind, transcriptId, transcriptRevision }),
        seq: session.next_event_seq,
        session_id: sessionId,
        subject_id: attemptId,
      })
      .execute();
    await transaction
      .updateTable('sessions')
      .set({ next_event_seq: session.next_event_seq + 1 })
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .executeTakeFirstOrThrow();
  }

  private assertVersion(current: number, expected: number) {
    if (current !== expected) throw new ConflictException('assessment version changed');
  }
}
