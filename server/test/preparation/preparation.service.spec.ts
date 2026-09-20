import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GuardResultSchema,
  PacketSchema,
  ProblemSchema,
  type Packet,
  type PreparationInput,
} from '../../src/contracts/domain.schema.js';
import type { ModelPort } from '../../src/model/model.port.js';
import type {
  PreparationCacheRecord,
  PreparationPacketStore,
  SavePreparationCacheInput,
} from '../../src/features/preparation/preparation.repository.js';
import { PreparationService } from '../../src/features/preparation/preparation.service.js';

const fixturesDirectory = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'qisi-sdd-v3',
  'fixtures',
);

function readFixture<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(fixturesDirectory, fileName), 'utf8')) as T;
}

const packet = PacketSchema.parse(readFixture('packet.json'));
const problem = ProblemSchema.parse(readFixture('problem.json'));
const acceptedGuard = GuardResultSchema.parse(readFixture('guard.json'));

class MemoryPreparationStore implements PreparationPacketStore {
  readonly records = new Map<string, PreparationCacheRecord>();
  readonly saves: SavePreparationCacheInput[] = [];

  async find(problemHash: string, version: string) {
    return this.records.get(`${problemHash}:${version}`) ?? null;
  }

  async save(input: SavePreparationCacheInput) {
    this.saves.push(input);
    this.records.set(`${input.problemHash}:${input.version}`, {
      packet: input.packet,
      review: input.review,
      status: input.status,
    });
  }
}

function createModel(candidate: Packet = packet, guard = acceptedGuard): ModelPort {
  return {
    generate: vi.fn((request) => Promise.resolve({
      elapsedMs: 5,
      model: 'fixture-model',
      parsed: request.role === 'preparation' ? candidate : guard,
      provider: 'fixture',
      usage: { input: 10, kind: 'reported' as const, output: 5 },
    })),
  };
}

function prepareInput(overrides: Partial<PreparationInput> = {}): PreparationInput {
  return {
    evidence_refs: [],
    mode: 'prepare',
    problem,
    reference_material_md: packet.reference_md,
    student_route_md: null,
    ...overrides,
  };
}

function createService(model = createModel(), store = new MemoryPreparationStore()) {
  return {
    model,
    service: new PreparationService(model, store as never),
    store,
  };
}

describe('B02 PreparationService', () => {
  it('stores a ready packet only after trusted source review and Guard acceptance', async () => {
    const { service, store } = createService();

    const result = await service.prepare(prepareInput(), {
      configHash: 'config-a',
      model: 'fixture-model',
    });

    expect(result.status).toBe('ready');
    expect(result.packet.ready).toBe(true);
    expect(result.packet.problem_hash).toBe(problem.content_hash);
    expect(result.packet.verification).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'source_reference',
        reference: `${problem.bank_version}:${problem.id}:${problem.content_hash}`,
        status: 'pass',
      }),
    ]));
    expect(result.packet.check_tasks).toHaveLength(2);
    expect(result.packet.check_tasks.every((task) => task.verified === false)).toBe(true);
    expect(store.saves).toHaveLength(1);
  });

  it('AT06 reuses the exact hash/runtime cache and misses after the problem hash changes', async () => {
    const { model, service, store } = createService();
    const options = { configHash: 'config-a', model: 'fixture-model' };

    const first = await service.prepare(prepareInput(), options);
    const replay = await service.prepare(prepareInput(), options);
    const changedHash = 'b'.repeat(64);
    const changed = await service.prepare(prepareInput({
      problem: { ...problem, content_hash: changedHash },
    }), options);

    expect(first.cached).toBe(false);
    expect(replay.cached).toBe(true);
    expect(changed.cached).toBe(false);
    expect(changed.packet.problem_hash).toBe(changedHash);
    expect(changed.status).toBe('needs_review');
    expect(store.saves.map((entry) => entry.problemHash)).toEqual([
      problem.content_hash,
      changedHash,
    ]);
    expect(model.generate).toHaveBeenCalledTimes(4);
  });

  it('AT05 downgrades model claims and keeps an unreviewed problem in needs_review', async () => {
    const { service, store } = createService();

    const result = await service.prepare(prepareInput({
      problem: { ...problem, status: 'needs_review' },
      reference_material_md: '',
    }), {
      configHash: 'config-a',
      model: 'fixture-model',
    });

    expect(result.status).toBe('needs_review');
    expect(result.packet.ready).toBe(false);
    expect(result.packet.verification.every((item) => item.kind === 'model_checked')).toBe(true);
    expect(result.packet.blocking_issues.join(' ')).toContain('题库状态为 needs_review');
    expect(store.saves[0]?.status).toBe('needs_review');
  });

  it('AT07 persists Guard uncertainty instead of publishing a ready packet', async () => {
    const unknownGuard = GuardResultSchema.parse({
      ...acceptedGuard,
      issues: ['参考答案与候选路线冲突'],
      verdict: 'unknown',
    });
    const { service, store } = createService(createModel(packet, unknownGuard));

    const result = await service.prepare(prepareInput(), {
      configHash: 'config-a',
      model: 'fixture-model',
    });

    expect(result.status).toBe('needs_review');
    expect(result.packet.blocking_issues.join(' ')).toContain('GUARD_NOT_ACCEPTED');
    expect(store.saves[0]?.review).toEqual(expect.objectContaining({
      guard: expect.objectContaining({ verdict: 'unknown' }),
    }));
  });

  it('binds an official solution image to the cache and gives it to Preparation and Guard', async () => {
    const { model, service } = createService();
    const firstImage = {
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png' as const,
    };
    const changedImage = {
      bytes: new Uint8Array([1, 2, 4]),
      mime: 'image/png' as const,
    };
    const options = {
      configHash: 'config-a',
      model: 'fixture-model',
      referenceImages: [firstImage],
    };

    await service.prepare(prepareInput(), options);
    await service.prepare(prepareInput(), options);
    await service.prepare(prepareInput(), {
      ...options,
      referenceImages: [changedImage],
    });

    expect(model.generate).toHaveBeenCalledTimes(4);
    expect(model.generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ images: [firstImage], role: 'preparation' }),
    );
    expect(model.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ images: [firstImage], role: 'guard' }),
    );
    expect(model.generate).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ images: [changedImage], role: 'preparation' }),
    );
    expect(model.generate).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ images: [changedImage], role: 'guard' }),
    );
  });

  it('loads only an exact ready packet for a bound learning session', async () => {
    const { service } = createService();
    const prepared = await service.prepare(prepareInput(), {
      configHash: 'config-a',
      model: 'fixture-model',
    });

    await expect(
      service.findReadyPacket(problem.content_hash, prepared.packet.version),
    ).resolves.toEqual(prepared.packet);
    await expect(
      service.findReadyPacket('b'.repeat(64), prepared.packet.version),
    ).resolves.toBeNull();
    await expect(
      service.findReadyPacket(problem.content_hash, 'c'.repeat(64)),
    ).resolves.toBeNull();
  });
});
