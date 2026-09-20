// Production teaching uses A's LearningSessionService transactions, not MemoryStore.
// createTurnRunner remains an explicit pure/fixture entry point. Each production request
// reloads committed teaching facts after reservation; no process-local map is authoritative.
// Dynamic route_review/skip/reveal integration and durable worker recovery remain separate work.

import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, type Provider } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../../config/env.js';
import {
  projectDiagnosisInput,
  projectGuardInput,
  projectRendererInput,
  projectStrategyInput,
} from '../../agents/context.js';
import type {
  AssessmentSource,
  DiagnosisSource,
  GuardSource,
  PreparationSource,
  RendererSource,
  StrategySource,
} from '../../agents/context.js';
import { StudentViewSchema, type Submission, type TurnInput } from '../../contracts/domain.schema.js';
import { MODEL_PORT, type ModelPort as UpstreamModelPort } from '../../model/model.port.js';
import type { ModelPort } from '../../model/ports.js';
import { UpstreamModelBridge } from '../../model/upstream-model-bridge.js';
import { LearningSessionService } from '../learning/learning-session.service.js';
import { LearningTurnStore, isPersistedAssistanceMode, type LearningTurnFacade } from './learning-turn.store.js';
import type { OrchestratorModels } from '../../workflows/orchestrator.js';
import { WorkflowOrchestrator } from '../../workflows/orchestrator.js';
import { workflowBudget } from '../../workflows/runtime.js';
import type { StorePort } from '../../workflows/store.port.js';
import { TurnWorkflow, type TurnStrategyContext } from '../../workflows/turn.js';
import type { SubmitTurnDeps, TutorSession, TutorSessionPort } from './tutor.service.js';
import { SUBMIT_TURN_DEPS, TUTOR_SESSION_PORT } from './tutor.service.js';

/**
 * 参与节点复用键的配置版本（orchestrator.#nodeInputHash）。
 *
 * 改动提示、模型或工作流配置时必须递增后缀，否则旧节点会被复用
 * （contracts/README.md §5 第 3 条：配置变化必须使旧节点失效）。
 * 前缀取自 runtime.json 的镜像常量，避免手写版本与规格脱节。
 */
const TURN_CONFIG_HASH = 'qisi-3.1-tutor-turn-v2-persistent';

/**
 * 被拒时给学生的中性说明。
 *
 * 不含任何内部标识：notice 经 StudentView 直达学生，见文件头。
 */
const NEUTRAL_REJECT_NOTICE = '本轮未产生可展示内容，请继续说明你的思路后重试。';

/**
 * 策略节点运行时，本轮预算剩余多少次模型调用。
 *
 * 规格 design-v6 §5.2：普通教学正常 4 次、硬上限 7 次；策略之前已消耗 1 次诊断，
 * 故按硬上限报剩余。夹具 strategy-input.json 的 remaining_calls 为 6，与 7-1 一致。
 *
 * 这是**策略时刻**的快照：其后的表达重写与 schema 修复会继续消耗，此处无法预知。
 */
const REMAINING_CALLS_AT_STRATEGY = workflowBudget('turn').max_calls - 1;

/** turn 阶段各投影函数真正读到的字段集合，外加各阶段自己的产出。 */
type TurnSources = PreparationSource &
  DiagnosisSource &
  Omit<RendererSource, 'strategy'> &
  GuardSource &
  AssessmentSource &
  Omit<StrategySource, 'diagnosis' | 'remainingProbes' | 'remainingCalls'>;

export interface TurnRunnerConfig {
  readonly store: StorePort;
  readonly modelPort: ModelPort;
  readonly models: OrchestratorModels;
  readonly configHash: string;
}

export interface TurnRunner {
  readonly runTurn: SubmitTurnDeps['runTurn'];
  readonly recordProbe: NonNullable<SubmitTurnDeps['recordProbe']>;
}

/**
 * 会话快照 + 本轮输入 → 四角色投影的输入源。
 *
 * 逐字段列全：新增降级必须在这里显式写一行，而不是靠默认值悄悄产生。
 */
function turnSources(session: TutorSession, input: TurnInput): TurnSources {
  return {
    taskId: session.problem.id,
    problem: session.problem,
    referenceMaterialMd: session.referenceMd,
    studentRouteMd: null, // 降级：学生自拟路线无来源
    submissions: submissionsFor(session, input),
    previousHypotheses: session.teachingState?.previousHypotheses ?? [],
    previousProbes: session.teachingState?.previousProbes ?? [],
    decisions: session.decisions,
    routes: session.routes,
    privateReferenceMd: session.referenceMd,
    userAction: input.action,
    exposures: session.teachingState?.exposures ?? [],
    routePatch: null,
    publicPromptMd: session.problem.statement_md,
    publicHistoryMd: publicHistoryFor(session, input),
    checkTask: session.checkTask,
    lockedPlanMd: session.attempt?.planMd ?? '',
    finalAnswerMd: session.attempt?.answerMd ?? '',
    guardReferenceMd: session.referenceMd,
  };
}

/**
 * 诊断证据：已提交的历史学生消息 + 本轮输入。
 *
 * `confirmed: true` 的理由：A 的会话模型里「确认」只用于手写转写待核对
 * （sessions.recognition_uncertain_json），打字输入没有待确认状态；而本轮输入
 * 是学生自己提交的请求体，提交动作本身即确认。历史行来自 learning_messages，
 * 其中同样不含未确认标记。
 *
 * revision 按 1 记：A 的 learning_messages 不含 revision 列（该字段服务于手写
 * 转写版本），本轮沿用 TurnInput.transcript_revision。
 */
function submissionsFor(session: TutorSession, input: TurnInput): readonly Submission[] {
  const taskId = session.problem.id;
  const history = session.submissions ?? session.messages
    .filter((message) => message.role === 'student')
    .map((message) => submissionOf({
      id: message.id,
      taskId,
      textMd: message.text_md,
      revision: 1,
      transcriptId: null,
      createdAt: message.created_at,
    }));

  return [
    ...history,
    submissionOf({
      id: `student-${input.request_id}`,
      taskId,
      textMd: input.text_md,
      revision: input.transcript_revision ?? 1,
      transcriptId: input.transcript_id,
      createdAt: new Date().toISOString(),
    }),
  ];
}

function submissionOf(params: {
  readonly id: string;
  readonly taskId: string;
  readonly textMd: string;
  readonly revision: number;
  readonly transcriptId: string | null;
  readonly createdAt: string;
}): Submission {
  return {
    id: params.id,
    task_id: params.taskId,
    revision: params.revision,
    text_md: params.textMd,
    // 转写来源的手写输入走 handwriting；打字输入是 typed（见 domain.schema）。
    source: params.transcriptId === null ? 'typed' : 'handwriting',
    media_id: null,
    transcript_id: params.transcriptId,
    confirmed: true,
    invalidated: false,
    created_at: params.createdAt,
  };
}

/**
 * 公开历史：已提交的公开消息 + 本轮输入。
 *
 * 含本轮输入的依据是夹具 renderer-input.json —— 其 public_history_md 恰好是学生
 * 本轮提交的那一行。表达节点据此才能回应学生刚写的内容。system 角色的消息是
 * 服务端内部记录，不属公开历史。
 */
function publicHistoryFor(session: TutorSession, input: TurnInput): readonly string[] {
  const committed = session.messages
    .filter((message) => message.role !== 'system')
    .map((message) => message.text_md);
  return [...committed, input.text_md];
}

/**
 * 构造 runTurn / recordProbe 两个函数。
 *
 * 与 Nest 无关，便于用 FixtureProvider + MemoryStore 直接装配测试
 * （见 test/tutor/submit-turn-deps.spec.ts）。
 */
export function createTurnRunner(config: TurnRunnerConfig): TurnRunner {
  const orchestrator = new WorkflowOrchestrator(config.store, config.modelPort, {
    models: config.models,
    configHash: config.configHash,
  });
  const turn = new TurnWorkflow();

  /**
   * 本轮产出的策略上下文，按会话暂存，供提交后的探针记账使用。
   *
   * 为什么要暂存：SubmitTurnDeps.recordProbe 的签名里没有策略上下文，而记账必须
   * 知道 canonical goal。TutorService 的调用顺序固定为 runTurn → save → recordProbe，
   * 故按会话传递。同一会话的并发轮次由 StorePort 的 lease 排除（一个会话只允许
   * 一个活动工作流），因此不会互相覆盖。
   */
  const strategyContexts = new Map<string, TurnStrategyContext>();

  const runTurn: SubmitTurnDeps['runTurn'] = async (params) => {
    const { session, input } = params;
    const taskId = session.problem.id;

    // 上一轮若在记账前中断，残留上下文会与新的一轮混淆。
    strategyContexts.delete(params.sessionId);
    turn.registerTask(taskId, session.decisions);
    if (session.teachingState) turn.probes.restore(session.id, taskId, session.teachingState.probesShownByGoal);

    const sources = turnSources(session, input);

    const outcome = await orchestrator.turn({
      sessionId: params.sessionId,
      requestId: params.requestId,
      payloadHash: params.payloadHash,
      expectedVersion: params.expectedVersion,
      diagnosisInput: projectDiagnosisInput(sources),
      // 见文件头：route_review 的产出在 turn() 里未被消费，接线只会白花预算。
      routeReviewInput: null,
      buildStrategyInput: (diagnosis) => {
        // 剩余探针数按**本轮诊断**聚焦的目标解析：策略输入必须在策略产出之前构造，
        // 此刻模型会聚焦哪个目标只有诊断说了。这是本阶段唯一诚实的来源。
        const context = turn.buildStrategyContext({
          sessionId: params.sessionId,
          taskId,
          decisions: session.decisions,
          strategy: { focus_goal_key: diagnosis.focus_goal_key, probe: diagnosis.probe },
        });
        return projectStrategyInput({
          ...sources,
          diagnosis,
          remainingProbes: context.remainingProbes,
          remainingCalls: REMAINING_CALLS_AT_STRATEGY,
        });
      },
      buildRendererInput: (strategy) => projectRendererInput({ ...sources, strategy }, strategy.allowed_facts),
      buildGuardInput: (strategy, candidate) =>
        projectGuardInput(sources, 'message', candidate, strategy.allowed_disclosures, strategy.reserved_decisions),
      knownDecisionIds: new Set(session.decisions.map((decision) => decision.id)),
      knownGoalKeys: new Set(session.decisions.map((decision) => decision.goal_key)),
      // 探针计数按**本轮策略**的目标解析，并顺手暂存上下文供提交后记账——
      // 两件事用的是同一份上下文，分开算会有分叉的风险。
      shownProbesFor: (strategy) => {
        const context = turn.buildStrategyContext({
          sessionId: params.sessionId,
          taskId,
          decisions: session.decisions,
          strategy,
        });
        strategyContexts.set(params.sessionId, context);
        return context.shownCount;
      },
    });

    if (outcome.status !== 'committed' || outcome.value === null) {
      // 未提交：不留上下文，否则 recordProbe 会为一次没发生的曝光记账。
      strategyContexts.delete(params.sessionId);
      return { status: 'rejected', textMd: null, notice: NEUTRAL_REJECT_NOTICE };
    }

    return { status: 'committed', textMd: outcome.value.message.text_md, notice: '' };
  };

  const recordProbe: NonNullable<SubmitTurnDeps['recordProbe']> = async (params) => {
    const context = strategyContexts.get(params.sessionId);
    strategyContexts.delete(params.sessionId);
    if (context === undefined) return;
    turn.recordCommittedProbe({ sessionId: params.sessionId, taskId: params.taskId, context });
  };

  return { runTurn, recordProbe };
}

/** SQL request_id is CHAR(36), while the public contract permits up to 128 characters. */
export function persistentRequestId(ownerId: string, requestId: string): string {
  const hex = createHash('sha256').update(JSON.stringify(['tutor-v1', ownerId, requestId])).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

export function createPersistentTurnDeps(config: Omit<TurnRunnerConfig, 'store'> & {
  learning: LearningTurnFacade; sessions: TutorSessionPort;
}): SubmitTurnDeps {
  return {
    sessions: config.sessions,
    atomicPersistence: true,
    runTurn: async params => {
      if (!params.ownerId) throw new ForbiddenException('authenticated owner required');
      if (!isPersistedAssistanceMode(params.input.action)) {
        throw new BadRequestException('this action requires the route workflow, which is not yet integrated');
      }
      if (Boolean(params.input.transcript_id) !== Boolean(params.input.transcript_revision)
        || (params.input.transcript_id !== null && !/^[1-9]\d*$/.test(params.input.transcript_id))) {
        throw new BadRequestException('invalid confirmed transcript reference');
      }
      const requestId = persistentRequestId(params.ownerId, params.requestId);
      const input = {...params.input, request_id:requestId};
      const reservation = await config.learning.reserveTurn({assistanceMode:params.input.action,
        protocol:'tutor-v1', ownerId:params.ownerId, sessionId:params.sessionId, requestId,
        expectedVersion:params.expectedVersion, message:input.text_md,
        ...(input.transcript_id ? {transcriptId:input.transcript_id, transcriptRevision:input.transcript_revision!} : {})});
      if (reservation.kind === 'replay') {
        if (!reservation.studentView) throw new ServiceUnavailableException('persisted teaching response unavailable');
        return {status:'committed',textMd:reservation.reply,notice:'',studentView:StudentViewSchema.parse(reservation.studentView)};
      }
      const boundParams = {...params, ownerId:params.ownerId, requestId, input};
      // Reserve first: same-request replay precedes CAS, and model inputs come from the reserved state.
      let store: LearningTurnStore | undefined;
      try {
        const session = await config.sessions.load(params.sessionId, params.ownerId);
        if (!session || session.phase !== 'study' || session.version !== reservation.expectedVersion
          || !reservation.packetVersion || session.packetVersion !== reservation.packetVersion) {
          throw new ConflictException('reserved teaching session changed or is not ready');
        }
        store = new LearningTurnStore(config.learning, reservation, boundParams, session);
        const runner = createTurnRunner({...config, store});
        const outcome = await runner.runTurn({...boundParams, session});
        if (outcome.status !== 'committed') {
          await store.fail();
          return outcome;
        }
        if (!store.studentView) throw new ServiceUnavailableException('checked response was not persisted');
        return {...outcome, studentView:store.studentView};
      } catch (error) {
        // A checks the exact run/lease before cleanup; completed/replaced runs are unaffected.
        await config.learning.failTurn({leaseToken:reservation.leaseToken, ownerId:params.ownerId,
          requestId, runId:reservation.runId, sessionId:params.sessionId, errorCode:'CHECKED_TURN_FAILED'});
        throw error;
      }
    },
  };
}

/**
 * 六个角色一律使用配置里的同一个模型。
 *
 * 这不是省事：UpstreamModelBridge 明确记录「按角色的模型路由失效」——A 的适配器
 * 只读 AI_MODEL，无法按请求指定。把六个角色都写成同一个值，是让节点复用键里的
 * 模型字段与**实际发生的调用**一致；填六个不同的假名字会让复用键看起来分了角色，
 * 实际没有。
 */
function turnModels(config: ConfigService<AppEnvironment, true>): OrchestratorModels {
  const model = config.get('AI_MODEL', { infer: true });
  return {
    preparation: model,
    diagnosis: model,
    strategy: model,
    assessment: model,
    renderer: model,
    guard: model,
  };
}

/**
 * 装配点：SUBMIT_TURN_DEPS。
 *
 * 会话端口从 TUTOR_SESSION_PORT 取，使「应用用哪个会话端口」只有一个绑定处；
 * 测试可覆盖该绑定换入内存端口。
 */
export const submitTurnDepsProvider: Provider = {
  provide: SUBMIT_TURN_DEPS,
  inject: [ConfigService, TUTOR_SESSION_PORT, MODEL_PORT, LearningSessionService],
  useFactory: (
    config: ConfigService<AppEnvironment, true>, sessions: TutorSessionPort,
    upstream: UpstreamModelPort, learning: LearningSessionService,
  ): SubmitTurnDeps => createPersistentTurnDeps({
    sessions, learning, modelPort:new UpstreamModelBridge(upstream),
    models:turnModels(config), configHash:TURN_CONFIG_HASH,
  }),
};
