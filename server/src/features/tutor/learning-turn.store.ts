// Request-scoped adapter to A's ONE transaction facade. No pool, DDL, memory fallback,
// checkpoint recovery, or second business commit. Recovery remains explicitly unavailable.
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { DiagnosisSchema, StrategySchema, StudentViewSchema, type StudentView } from '../../contracts/domain.schema.js';
import type { ActiveRunContext, CheckedMutation, NodeExecutionAudit, ReserveInput, SqlTransaction, StorePort } from '../../workflows/store.port.js';
import type { LearningSessionService, ReservedTurn } from '../learning/learning-session.service.js';
import type { SubmitTurnDeps, TutorSession } from './tutor.service.js';
import { CanonicalGoalRegistry } from './probe-counter.js';
import { projectStudentView } from './student-view.js';

export type LearningTurnFacade = Pick<LearningSessionService, 'reserveTurn' | 'recordTurnNode' | 'commitTurn' | 'failTurn'>;
type Params = Parameters<SubmitTurnDeps['runTurn']>[0] & { ownerId: string };
const exposureSchema = z.strictObject({disclosures:z.array(z.string()), whole_task:z.boolean()});

export class LearningTurnStore implements StorePort {
  studentView: StudentView | undefined;
  constructor(private readonly learning: LearningTurnFacade, private readonly reservation: ReservedTurn,
    private readonly params: Params, private readonly session: TutorSession) {}

  private assertRun(runId: string, leaseToken: string) {
    if (runId !== this.reservation.runId || leaseToken !== this.reservation.leaseToken) {
      throw new ConflictException('turn lease mismatch');
    }
  }
  async reserve(input: ReserveInput) {
    if (input.workflow !== 'turn' || input.sessionId !== this.params.sessionId || input.requestId !== this.params.requestId
      || input.expectedVersion !== this.reservation.expectedVersion || input.payloadHash !== this.params.payloadHash) {
      throw new ConflictException('reserved turn mismatch');
    }
    return { runId:this.reservation.runId, leaseToken:this.reservation.leaseToken,
      reservedVersion:this.reservation.expectedVersion, deadlineAt:this.reservation.deadlineAt };
  }
  async getReusableNode(runId: string): Promise<null> {
    if (runId !== this.reservation.runId) throw new ConflictException('turn mismatch');
    // This adapter only receives newly reserved runs. It never pretends to recover old nodes/budgets.
    return null;
  }
  async saveNode(runId: string, leaseToken: string, nodeKey: string, inputHash: string, output: unknown, audit?: NodeExecutionAudit) {
    this.assertRun(runId, leaseToken);
    if (!audit) throw new ServiceUnavailableException('node execution audit required');
    await this.learning.recordTurnNode({ runId, leaseToken, ownerId:this.params.ownerId, nodeKey, inputHash,
      output, modelId:audit.modelId, promptVersion:audit.promptVersion, startedAt:audit.startedAt,
      finishedAt:audit.finishedAt, status:'completed', usage:{ ...audit.response.usage,
        elapsedMs:audit.response.elapsedMs, provider:audit.response.provider,
        ...(audit.response.providerRequestId ? {providerRequestId:audit.response.providerRequestId} : {}) } });
  }
  async commitChecked(runId: string, leaseToken: string, reservedVersion: number, mutation: CheckedMutation) {
    this.assertRun(runId, leaseToken);
    if (mutation.sessionId !== this.params.sessionId || reservedVersion !== this.reservation.expectedVersion || !mutation.teaching) {
      throw new ConflictException('checked turn mismatch');
    }
    const diagnosis = DiagnosisSchema.parse(mutation.teaching.diagnosis);
    const strategy = StrategySchema.parse(mutation.teaching.strategy);
    const exposure = exposureSchema.parse(mutation.exposure);
    const registry = new CanonicalGoalRegistry();
    registry.register(this.session.problem.id, this.session.decisions);
    const focus = this.session.decisions.find(d => d.goal_key === strategy.focus_goal_key);
    const canonicalProbeGoalKey = strategy.probe && focus ? registry.resolve(this.session.problem.id, focus) : null;
    if (strategy.probe && !canonicalProbeGoalKey) throw new ConflictException('unknown probe goal');
    const now = new Date().toISOString();
    const view = projectStudentView({sessionId:this.session.id, version:reservedVersion+1, phase:'study',
      problem:this.session.problem, activeTaskPromptMd:this.session.problem.statement_md,
      messages:[...this.session.messages,
        {id:`student-${this.params.requestId}`,role:'student',text_md:this.params.input.text_md,created_at:now},
        {id:`teacher-${this.params.requestId}`,role:'teacher',text_md:mutation.safeMessageMd,created_at:now}],
      decisions:this.session.decisions, currentGoalKey:strategy.focus_goal_key, attempt:this.session.attempt,
      notice:'', runStatus:'idle', canStartCheck:this.session.canStartCheck});
    const input = this.params.input;
    if (!isPersistedAssistanceMode(input.action)) throw new ConflictException('action requires a separate workflow');
    const committed = await this.learning.commitTurn({runId, leaseToken, ownerId:this.params.ownerId,
      requestId:this.params.requestId, sessionId:this.params.sessionId, expectedVersion:reservedVersion,
      assistanceMode:input.action, message:input.text_md, reply:mutation.safeMessageMd,
      ...(input.transcript_id ? {transcriptId:input.transcript_id, transcriptRevision:input.transcript_revision!} : {}),
      audit:{decisionIds:exposure.disclosures, wholeTaskDisclosed:exposure.whole_task, focusGoalKey:strategy.focus_goal_key,
        intervention:strategy.intervention, scaffoldLevel:strategy.scaffold_level, probe:strategy.probe,
        probeGoalKey:strategy.probe?.goal_key ?? null},
      checkedTeaching:{studentView:StudentViewSchema.parse(view), taskId:this.session.problem.id,
        contentHash:this.session.problem.content_hash, diagnosis, strategy, canonicalProbeGoalKey,
        previousProbeCount: canonicalProbeGoalKey ? this.session.teachingState?.probesShownByGoal[canonicalProbeGoalKey] ?? 0 : 0,
        evidenceTranscripts: (this.session.submissions ?? []).flatMap(submission =>
          submission.confirmed && !submission.invalidated && submission.transcript_id
            ? [{ transcriptId:submission.transcript_id, transcriptRevision:submission.revision, message:submission.text_md }] : [])}});
    this.studentView = StudentViewSchema.parse(committed.studentView);
    return this.studentView;
  }
  async fail() {
    await this.learning.failTurn({runId:this.reservation.runId, leaseToken:this.reservation.leaseToken,
      ownerId:this.params.ownerId, requestId:this.params.requestId, sessionId:this.params.sessionId,
      errorCode:'CHECKED_TURN_FAILED'});
  }
  async revoke(): Promise<never> { throw new ServiceUnavailableException('use owner-scoped cancellation'); }
  async withActiveRun<T>(input: ActiveRunContext, work: (tx:SqlTransaction)=>Promise<T>): Promise<T> {
    void input; void work;
    throw new ServiceUnavailableException('generic transaction callbacks are not supported by this turn adapter');
  }
  async getCommittedResult(): Promise<never> { throw new ServiceUnavailableException('replay is handled by reserveTurn'); }
  async claimRecovery(): Promise<never> { throw new ServiceUnavailableException('durable worker recovery not implemented'); }
}

export function isPersistedAssistanceMode(action: string): action is 'attempt' | 'hint' | 'explain' | 'worked_solution' | 'finish_problem' {
  return ['attempt','hint','explain','worked_solution','finish_problem'].includes(action);
}
