import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GuardResultSchema,
  PacketSchema,
  type Packet,
} from '../../src/contracts/domain.schema.js';
import { gatePreparation } from '../../src/workflows/policy-gate.js';

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
const acceptedGuard = GuardResultSchema.parse(readFixture('guard.json'));

function context(overrides: Record<string, unknown> = {}) {
  return {
    expectedProblemHash: packet.problem_hash,
    guard: acceptedGuard,
    trustedVerificationReferences: new Set(['自拟开发夹具']),
    ...overrides,
  };
}

describe('B02 preparation policy', () => {
  it('accepts a structurally valid packet only with trusted review context', () => {
    expect(gatePreparation(packet, context()).approved).toBe(true);
  });

  it('AT06 rejects a packet bound to an old problem hash', () => {
    expect(gatePreparation(packet, context({ expectedProblemHash: 'a'.repeat(64) }))).toMatchObject({
      approved: false,
      code: 'PACKET_HASH_MISMATCH',
    });
  });

  it('AT05 does not treat model_checked as mathematical certification', () => {
    const modelOnly: Packet = {
      ...packet,
      verification: packet.verification.map((item) => ({
        ...item,
        kind: 'model_checked' as const,
        reference: 'model-self-check',
      })),
    };

    expect(gatePreparation(modelOnly, context({
      trustedVerificationReferences: new Set<string>(),
    }))).toMatchObject({
      approved: false,
      code: 'PACKET_UNVERIFIED',
    });
  });

  it('AT07 keeps a Guard conflict in needs_review', () => {
    const unknownGuard = GuardResultSchema.parse({
      ...acceptedGuard,
      issues: ['参考材料与候选结论冲突'],
      verdict: 'unknown',
    });

    expect(gatePreparation(packet, context({ guard: unknownGuard }))).toMatchObject({
      approved: false,
      code: 'GUARD_NOT_ACCEPTED',
    });
  });

  it('rejects a structurally valid packet whose route prerequisites form a cycle', () => {
    const cyclic: Packet = {
      ...packet,
      decisions: packet.decisions.map((decision, index) => {
        if (index === 0) return { ...decision, prerequisite_ids: [packet.decisions[1]!.id] };
        if (index === 1) return { ...decision, prerequisite_ids: [packet.decisions[0]!.id] };
        return decision;
      }),
    };

    expect(gatePreparation(cyclic, context())).toMatchObject({
      approved: false,
      code: 'PACKET_SEMANTIC_INVALID',
    });
  });

  it('requires at least two follow-up candidates without certifying them', () => {
    expect(gatePreparation({ ...packet, check_tasks: packet.check_tasks.slice(0, 1) }, context())).toMatchObject({
      approved: false,
      code: 'PACKET_CHECK_TASKS_INSUFFICIENT',
    });
  });
});
