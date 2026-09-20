import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PreparationAgent } from '../../agents/preparation/index.js';
import { Guard } from '../../agents/guard/index.js';
import {
  PacketSchema,
  type GuardInput,
  type Packet,
  type PreparationInput,
  type Verification,
} from '../../contracts/domain.schema.js';
import { MODEL_PORT, type ModelPort } from '../../model/model.port.js';
import type {
  ModelImage,
  ModelPort as RoleModelPort,
} from '../../model/ports.js';
import { gatePreparation } from '../../workflows/policy-gate.js';
import { PreparationRepository } from './preparation.repository.js';

export interface PreparePacketOptions {
  readonly configHash: string;
  readonly model: string;
  readonly referenceImages?: readonly ModelImage[];
  readonly signal?: AbortSignal;
}

export interface PreparedPacketResult {
  readonly cached: boolean;
  readonly packet: Packet;
  readonly status: 'needs_review' | 'ready';
}

function runtimeVersion(
  input: PreparationInput,
  model: string,
  configHash: string,
  promptVersion: string,
  referenceImages: readonly ModelImage[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      configHash,
      model,
      problemHash: input.problem.content_hash,
      promptVersion,
      referenceHash: createHash('sha256').update(input.reference_material_md).digest('hex'),
      referenceImages: referenceImages.map((image) => ({
        contentHash: createHash('sha256').update(image.bytes).digest('hex'),
        mime: image.mime,
      })),
    }))
    .digest('hex');
}

function trustedReference(input: PreparationInput): Verification | null {
  if (input.problem.status !== 'ready' || input.reference_material_md.trim().length === 0) {
    return null;
  }

  return {
    checked_at: new Date().toISOString(),
    kind: 'source_reference',
    reference: `${input.problem.bank_version}:${input.problem.id}:${input.problem.content_hash}`,
    reviewer_or_model: 'server-bank-ready-source',
    status: 'pass',
    summary: '题库服务端状态为 ready，且本次备课输入包含对应参考材料。',
  };
}

function uniqueIssues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 30);
}

function downgradeModelVerifications(
  verifications: readonly Verification[],
  model: string,
): Verification[] {
  return verifications.map((verification) => ({
    ...verification,
    kind: 'model_checked',
    reviewer_or_model: model,
  }));
}

@Injectable()
export class PreparationService {
  constructor(
    @Inject(MODEL_PORT) private readonly modelPort: ModelPort,
    @Inject(PreparationRepository) private readonly repository: PreparationRepository,
    @Inject(PreparationAgent) private readonly preparationAgent = new PreparationAgent(),
    @Inject(Guard) private readonly guard = new Guard(),
  ) {}

  async findReadyPacket(problemHash: string, version: string): Promise<Packet | null> {
    const cached = await this.repository.find(problemHash, version);
    if (!cached || cached.status !== 'ready' || !cached.packet.ready) return null;
    if (cached.packet.problem_hash !== problemHash || cached.packet.version !== version) return null;
    return cached.packet;
  }

  async prepare(input: PreparationInput, options: PreparePacketOptions): Promise<PreparedPacketResult> {
    if (input.mode !== 'prepare') throw new Error('PreparationService.prepare only accepts prepare mode');
    const referenceImages = options.referenceImages ?? [];
    const version = runtimeVersion(
      input,
      options.model,
      options.configHash,
      this.preparationAgent.promptVersion,
      referenceImages,
    );
    const cached = await this.repository.find(input.problem.content_hash, version);
    if (cached) return { cached: true, packet: cached.packet, status: cached.status };

    const signal = options.signal ?? new AbortController().signal;
    const model = this.modelPort as unknown as RoleModelPort;
    const generated = await this.preparationAgent.run(input, model, {
      ...(referenceImages.length ? { images: referenceImages } : {}),
      maxOutputTokens: 4000,
      model: options.model,
      signal,
    });
    if (generated.mode !== 'prepare') throw new Error('PreparationAgent returned an unexpected mode');

    const candidate = generated.packet;
    const sourceReview = trustedReference(input);
    const initialIssues = uniqueIssues([
      ...candidate.blocking_issues,
      ...(candidate.problem_id === input.problem.id ? [] : ['候选 problem_id 与题目快照不一致']),
      ...(candidate.problem_hash === input.problem.content_hash ? [] : ['候选 problem_hash 与题目快照不一致']),
      ...(input.problem.status === 'ready' ? [] : [`题库状态为 ${input.problem.status}`]),
      ...(input.reference_material_md.trim() ? [] : ['缺少可核对参考材料']),
      ...(candidate.routes.every((route) => route.math_status === 'valid') ? [] : ['存在未核对或无效路线']),
      ...(candidate.check_tasks.length >= 2 ? [] : ['检验候选少于两项']),
      ...(candidate.check_tasks.every((task) => task.source_problem_id === input.problem.id)
        ? []
        : ['检验候选引用了其他原题']),
    ]);

    const normalized = PacketSchema.parse({
      ...candidate,
      blocking_issues: initialIssues,
      check_tasks: candidate.check_tasks.map((task) => ({
        ...task,
        verification: downgradeModelVerifications(task.verification, options.model),
        verified: false,
      })),
      problem_hash: input.problem.content_hash,
      problem_id: input.problem.id,
      ready: initialIssues.length === 0,
      reference_source: sourceReview ? input.problem.source : candidate.reference_source,
      verification: [
        ...downgradeModelVerifications(candidate.verification, options.model),
        ...(sourceReview ? [sourceReview] : []),
      ],
      version,
    });

    const guardInput: GuardInput = {
      allowed_disclosures: [],
      candidate_json: JSON.stringify(normalized),
      mode: 'packet',
      reference_md: input.reference_material_md,
      reserved_decisions: [],
      task_id: input.problem.id,
    };
    const guardResult = await this.guard.run(guardInput, model, {
      ...(referenceImages.length ? { images: referenceImages } : {}),
      maxOutputTokens: 1000,
      model: options.model,
      signal,
    });
    const trustedReferences = new Set(sourceReview ? [sourceReview.reference] : []);
    const decision = gatePreparation(normalized, {
      expectedProblemHash: input.problem.content_hash,
      guard: guardResult.value,
      trustedVerificationReferences: trustedReferences,
    });
    const packet = decision.approved
      ? normalized
      : PacketSchema.parse({
          ...normalized,
          blocking_issues: uniqueIssues([...normalized.blocking_issues, `${decision.code}: ${decision.reason}`]),
          ready: false,
        });
    const status = packet.ready ? 'ready' : 'needs_review';
    await this.repository.save({
      configHash: options.configHash,
      modelId: options.model,
      packet,
      problemHash: input.problem.content_hash,
      promptVersion: this.preparationAgent.promptVersion,
      review: { decision, guard: guardResult.value },
      status,
      version,
    });

    return { cached: false, packet, status };
  }
}
