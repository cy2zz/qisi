// 工作流内核：prepare / turn / grade 的显式节点序列。
//
// 编排形态见 docs/adr/001-orchestration.md：不使用图执行引擎，节点顺序在编译期可枚举。
// 节点级恢复走 StorePort.getReusableNode / saveNode（对应 node_runs 表），
// 与任何图库无关。
//
// 本文件不含 Nest 装饰器，便于以内存 StorePort 与 FixtureProvider 直接装配测试。
// 接入 app.module.ts 属 A 的写集，作为交接项（B01 写集不含装配入口）。

import { createHash } from 'node:crypto';
import type { AssessmentOutput, Diagnosis, GuardResult, Packet, RenderedMessage, RoutePatch, Strategy } from '../contracts/domain.schema.js';
import { DiagnosisAgent } from '../agents/diagnosis/index.js';
import { Guard } from '../agents/guard/index.js';
import { PreparationAgent, type PreparationResult } from '../agents/preparation/index.js';
import { Renderer } from '../agents/renderer/index.js';
import { StrategyAgent } from '../agents/strategy/index.js';
import type { AgentCallOptions } from '../agents/agent-runtime.js';
import type { AssessmentAdapter } from '../agents/assessment-port.js';
import { AssessmentNotConfiguredError } from '../agents/assessment-port.js';
import { BudgetLedger } from '../model/budget.js';
import { BudgetedModelPort } from '../model/budgeted.provider.js';
import type { ModelPort, ModelResponse } from '../model/ports.js';
import { PROMPT_VERSION } from '../prompts/index.js';
import { gateGrading, gatePreparation, gateTurn, type PolicyDecision } from './policy-gate.js';
import type { ActiveRunContext, CheckedMutation, StorePort } from './store.port.js';
import { workflowBudget, type WorkflowName } from './runtime.js';

export interface OrchestratorModels {
  readonly preparation: string;
  readonly diagnosis: string;
  readonly strategy: string;
  readonly assessment: string;
  readonly renderer: string;
  readonly guard: string;
}

export interface OrchestratorConfig {
  readonly models: OrchestratorModels;
  /** 影响节点复用的配置哈希。配置变化必须使旧节点失效（contracts/README.md §5 第 3 条）。 */
  readonly configHash: string;
}

export interface TurnCommand {
  readonly sessionId: string;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly expectedVersion: number;
  readonly diagnosisInput: unknown;
  readonly routeReviewInput: unknown | null;
  readonly strategyInput: unknown;
  readonly rendererInput: unknown;
  readonly guardInput: unknown;
  readonly knownDecisionIds: ReadonlySet<string>;
  readonly probesShownForFocusGoal: number;
}

export interface WorkflowOutcome<T> {
  readonly status: 'committed' | 'rejected' | 'replayed';
  readonly value: T | null;
  readonly decision?: PolicyDecision;
}

export class WorkflowOrchestrator {
  readonly #store: StorePort;
  readonly #provider: ModelPort;
  readonly #config: OrchestratorConfig;

  readonly preparation = new PreparationAgent();
  readonly diagnosis = new DiagnosisAgent();
  readonly strategy = new StrategyAgent();
  readonly renderer = new Renderer();
  readonly guard = new Guard();

  constructor(store: StorePort, provider: ModelPort, config: OrchestratorConfig) {
    this.#store = store;
    this.#provider = provider;
    this.#config = config;
  }

  // ---- 节点执行与复用 ----

  /**
   * 节点输入哈希。规格要求复用必须同时匹配输入、模型、提示与配置
   * （contracts/README.md §5 第 3 条）——任一变化即落回未命中，照常扣预算。
   */
  #nodeInputHash(nodeKey: string, model: string, input: unknown): string {
    const payload = JSON.stringify({ nodeKey, model, promptVersion: PROMPT_VERSION, configHash: this.#config.configHash, input });
    return createHash('sha256').update(payload ?? '').digest('hex');
  }

  async #runNode<T>(params: {
    readonly runId: string;
    readonly leaseToken: string;
    readonly nodeKey: string;
    readonly model: string;
    readonly input: unknown;
    readonly execute: () => Promise<{ value: T; response: ModelResponse }>;
  }): Promise<{ value: T; reused: boolean }> {
    const inputHash = this.#nodeInputHash(params.nodeKey, params.model, params.input);
    const reusable = await this.#store.getReusableNode(params.runId, params.nodeKey, inputHash);
    if (reusable !== null && reusable !== undefined) {
      // 复用已完成的私有节点结果，不重复调用、不重复扣预算。
      return { value: reusable as T, reused: true };
    }
    const { value } = await params.execute();
    await this.#store.saveNode(params.runId, params.leaseToken, params.nodeKey, inputHash, value);
    return { value, reused: false };
  }

  #callOptions(model: string, budget: BudgetLedger): AgentCallOptions {
    return { model, signal: budget.signal };
  }

  /**
   * PreparationAgent 输出可辨识结果（mode 决定 Packet 或 RoutePatch），
   * 与 #runNode 期望的 {value, response} 形状不同，此处适配。
   */
  async #runPreparation(
    input: unknown,
    port: ModelPort,
    options: AgentCallOptions,
    node: { runId: string; leaseToken: string; nodeKey: string; model: string },
  ): Promise<{ value: PreparationResult; reused: boolean }> {
    return this.#runNode<PreparationResult>({
      ...node,
      input,
      execute: async () => {
        const result = await this.preparation.run(input as never, port, options);
        return { value: result, response: result.response };
      },
    });
  }

  // ---- prepare ----

  async prepare(command: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly payloadHash: string;
    readonly expectedVersion: number;
    readonly preparationInput: unknown;
  }): Promise<WorkflowOutcome<Packet | RoutePatch>> {
    const run = await this.#reserve('prepare', command);
    const budget = new BudgetLedger({ workflow: 'prepare', deadlineAt: new Date(run.deadlineAt) });
    const port = new BudgetedModelPort(this.#provider, budget);
    const model = this.#config.models.preparation;

    const prepared = await this.#runPreparation(command.preparationInput, port, this.#callOptions(model, budget), {
      runId: run.runId,
      leaseToken: run.leaseToken,
      nodeKey: 'preparation',
      model,
    });

    if (prepared.value.mode === 'route_review') {
      // route_review 的补丁是候选数据，需经 Guard 才可成为新版本。
      return { status: 'committed', value: prepared.value.patch };
    }

    const packet = prepared.value.packet;
    const decision = gatePreparation(packet);
    if (!decision.approved) {
      return { status: 'rejected', value: null, decision };
    }

    await this.#store.commitChecked(run.runId, run.leaseToken, run.reservedVersion, {
      sessionId: command.sessionId,
      safeMessageMd: '',
      exposure: null,
      events: [{ type: 'preparation_verified', problem_id: packet.problem_id }],
      nextState: { packet_version: packet.version },
      safeResponse: { problem_id: packet.problem_id, version: packet.version },
    } satisfies CheckedMutation);

    return { status: 'committed', value: packet };
  }

  // ---- turn ----

  async turn(command: TurnCommand): Promise<WorkflowOutcome<{ message: RenderedMessage; diagnosis: Diagnosis; strategy: Strategy }>> {
    const run = await this.#reserve('turn', command);
    const budget = new BudgetLedger({ workflow: 'turn', deadlineAt: new Date(run.deadlineAt) });
    const port = new BudgetedModelPort(this.#provider, budget);

    const diagnosisModel = this.#config.models.diagnosis;
    const diagnosisNode = await this.#runNode({
      runId: run.runId,
      leaseToken: run.leaseToken,
      nodeKey: 'diagnosis',
      model: diagnosisModel,
      input: command.diagnosisInput,
      execute: () => this.diagnosis.run(command.diagnosisInput as never, port, this.#callOptions(diagnosisModel, budget)),
    });
    const diagnosis = diagnosisNode.value;

    // route_review 仅在诊断提出且预算够两次调用（Preparation + Guard）时执行。
    if (diagnosis.route_review_needed && command.routeReviewInput !== null && budget.consumeRouteReview()) {
      const preparationModel = this.#config.models.preparation;
      await this.#runPreparation(command.routeReviewInput, port, this.#callOptions(preparationModel, budget), {
        runId: run.runId,
        leaseToken: run.leaseToken,
        nodeKey: 'route_review',
        model: preparationModel,
      });
    }

    const strategyModel = this.#config.models.strategy;
    const strategyNode = await this.#runNode({
      runId: run.runId,
      leaseToken: run.leaseToken,
      nodeKey: 'strategy',
      model: strategyModel,
      input: command.strategyInput,
      execute: () => this.strategy.run(command.strategyInput as never, port, this.#callOptions(strategyModel, budget)),
    });
    const strategy = strategyNode.value;

    const rendered = await this.#renderAndGuard(run, budget, port, command, strategy);
    if (!rendered.approved) {
      return { status: 'rejected', value: null, decision: rendered.decision };
    }

    await this.#store.commitChecked(run.runId, run.leaseToken, run.reservedVersion, {
      sessionId: command.sessionId,
      safeMessageMd: rendered.message.text_md,
      exposure: { disclosures: rendered.approvedDisclosures, whole_task: rendered.wholeTaskDisclosed },
      events: [{ type: 'turn_committed', focus_goal_key: strategy.focus_goal_key }],
      nextState: { current_goal: strategy.focus_goal_key },
      safeResponse: { text_md: rendered.message.text_md },
    } satisfies CheckedMutation);

    return { status: 'committed', value: { message: rendered.message, diagnosis, strategy } };
  }

  /** Renderer → Guard → PolicyGate，至多一次受控重写，共用同一预算。 */
  async #renderAndGuard(
    run: { runId: string; leaseToken: string },
    budget: BudgetLedger,
    port: ModelPort,
    command: TurnCommand,
    strategy: Strategy,
  ): Promise<
    | { approved: true; message: RenderedMessage; approvedDisclosures: readonly string[]; wholeTaskDisclosed: boolean }
    | { approved: false; decision: PolicyDecision }
  > {
    const rendererModel = this.#config.models.renderer;
    const guardModel = this.#config.models.guard;

    const renderOnce = async (): Promise<RenderedMessage> => {
      const node = await this.#runNode<RenderedMessage>({
        runId: run.runId,
        leaseToken: run.leaseToken,
        nodeKey: 'renderer',
        model: rendererModel,
        input: command.rendererInput,
        execute: () => this.renderer.run(command.rendererInput as never, port, this.#callOptions(rendererModel, budget)),
      });
      return node.value;
    };

    const guardOnce = async (message: RenderedMessage): Promise<GuardResult> => {
      const guardInput = { ...(command.guardInput as Record<string, unknown>), candidate_json: JSON.stringify(message) };
      const node = await this.#runNode<GuardResult>({
        runId: run.runId,
        leaseToken: run.leaseToken,
        nodeKey: 'guard',
        model: guardModel,
        input: guardInput,
        execute: () => this.guard.run(guardInput as never, port, this.#callOptions(guardModel, budget)),
      });
      return node.value;
    };

    let message = await renderOnce();
    let guardResult = await guardOnce(message);
    let decision = gateTurn({
      strategy,
      guard: guardResult,
      knownDecisionIds: command.knownDecisionIds,
      probesShownForFocusGoal: command.probesShownForFocusGoal,
    });

    // 仅当被 Guard 退回（而非被代码边界否决）且仍有重写额度时才重写一次。
    if (!decision.approved && decision.code === 'GUARD_NOT_ACCEPTED' && budget.consumeTextRewrite()) {
      const rewriteNode = await this.#runNode<RenderedMessage>({
        runId: run.runId,
        leaseToken: run.leaseToken,
        nodeKey: 'renderer_rewrite',
        model: rendererModel,
        input: command.rendererInput,
        execute: () => this.renderer.run(command.rendererInput as never, port, this.#callOptions(rendererModel, budget)),
      });
      message = rewriteNode.value;
      guardResult = await guardOnce(message);
      decision = gateTurn({
        strategy,
        guard: guardResult,
        knownDecisionIds: command.knownDecisionIds,
        probesShownForFocusGoal: command.probesShownForFocusGoal,
      });
    }

    if (!decision.approved) return { approved: false, decision };
    return {
      approved: true,
      message,
      approvedDisclosures: decision.approvedDisclosures,
      wholeTaskDisclosed: decision.wholeTaskDisclosed,
    };
  }

  // ---- grade ----

  async grade(command: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly payloadHash: string;
    readonly expectedVersion: number;
    readonly assessmentInput: unknown;
    readonly assessment: AssessmentAdapter | null;
  }): Promise<WorkflowOutcome<AssessmentOutput>> {
    // 非测试运行不得静默降级为替身（B01 PRD F2 边界条件）：未装配即显式失败。
    if (command.assessment === null) {
      throw new AssessmentNotConfiguredError();
    }

    const run = await this.#reserve('grade', command);
    const budget = new BudgetLedger({ workflow: 'grade', deadlineAt: new Date(run.deadlineAt) });
    const model = this.#config.models.assessment;

    const node = await this.#runNode<AssessmentOutput>({
      runId: run.runId,
      leaseToken: run.leaseToken,
      nodeKey: 'assessment',
      model,
      input: command.assessmentInput,
      execute: async () => {
        const value = await command.assessment?.agent.run(command.assessmentInput as never, this.#callOptions(model, budget));
        if (value === undefined) throw new AssessmentNotConfiguredError();
        return { value, response: { parsed: value, usage: { input: 0, output: 0, kind: 'reported' as const }, elapsedMs: 0, provider: 'assessment-adapter', model } };
      },
    });

    const decision = gateGrading(node.value);
    if (!decision.approved) {
      return { status: 'rejected', value: null, decision };
    }

    await this.#store.commitChecked(run.runId, run.leaseToken, run.reservedVersion, {
      sessionId: command.sessionId,
      safeMessageMd: '',
      exposure: null,
      events: [{ type: 'grading_committed', task_id: node.value.task_id }],
      nextState: { planning: node.value.planning, execution: node.value.execution },
      safeResponse: { task_id: node.value.task_id, planning: node.value.planning, execution: node.value.execution },
    } satisfies CheckedMutation);

    return { status: 'committed', value: node.value };
  }

  // ---- run 生命周期 ----

  async #reserve(
    workflow: WorkflowName,
    command: { readonly sessionId: string; readonly requestId: string; readonly payloadHash: string; readonly expectedVersion: number },
  ): Promise<{ runId: string; leaseToken: string; reservedVersion: number; deadlineAt: string }> {
    const reserved = await this.#store.reserve({
      sessionId: command.sessionId,
      requestId: command.requestId,
      payloadHash: command.payloadHash,
      workflow,
      expectedVersion: command.expectedVersion,
    });
    return reserved;
  }

  /** 供恢复路径使用：以新 lease 接管未完成的 run。 */
  async recover(runId: string): Promise<ActiveRunContext | null> {
    return this.#store.claimRecovery(runId);
  }

  budgetOf(workflow: WorkflowName) {
    return workflowBudget(workflow);
  }
}
