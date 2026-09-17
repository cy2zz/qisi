import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnosis, Packet, Report, SelectInput, Strategy, TranscriptDraft } from './domain.schema.js';
import {
  validateDiagnosisEvidence,
  validatePacket,
  validateReport,
  validateSelectInput,
  validateStrategy,
  validateUntrustedTranscriptDraft,
  type ConfirmedSubmissionFact,
  type SemanticContext,
  type SemanticIssue,
} from './semantic.js';

// 与 domain.schema.spec.ts 相同，直接读规格包夹具，只读不写。
const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');

type JsonKey = string | number;

interface NegativeCase {
  id: string;
  base: string;
  type: string;
  path: JsonKey[];
  value: unknown;
  layer: 'schema' | 'semantic';
}

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(fixturesDirectory, fileName), 'utf8')) as T;
}

function descend(node: unknown, key: JsonKey): unknown {
  if (typeof node !== 'object' || node === null) throw new Error(`Cannot descend at ${String(key)}`);
  if (Array.isArray(node)) {
    if (typeof key !== 'number') throw new Error(`Array index must be numeric, got ${String(key)}`);
    return node[key];
  }
  return (node as Record<string, unknown>)[String(key)];
}

function assign(node: unknown, key: JsonKey, value: unknown): void {
  if (typeof node !== 'object' || node === null) throw new Error(`Cannot assign at ${String(key)}`);
  if (Array.isArray(node)) {
    if (typeof key !== 'number') throw new Error(`Array index must be numeric, got ${String(key)}`);
    node[key] = value;
    return;
  }
  (node as Record<string, unknown>)[String(key)] = value;
}

function withInjectedValue(base: unknown, keys: readonly JsonKey[], value: unknown): unknown {
  const copy = structuredClone(base);
  if (keys.length === 0) return value;
  let cursor = copy;
  for (const key of keys.slice(0, -1)) cursor = descend(cursor, key);
  assign(cursor, keys[keys.length - 1] as JsonKey, value);
  return copy;
}

// ---- 可信事实：全部取自服务端夹具，模拟领域服务提供的上下文 ----

const packetFixture = readJson<Packet>('packet.json');
const problemFixture = readJson<{ content_hash: string }>('problem.json');
const sessionFixture = readJson<{
  submissions: { id: string; revision: number; text_md: string; confirmed: boolean; invalidated: boolean }[];
}>('session.json');

const confirmedSubmissions = new Map<string, ConfirmedSubmissionFact>(
  sessionFixture.submissions
    .filter((submission) => submission.confirmed && !submission.invalidated)
    .map((submission) => [
      submission.id,
      {
        id: submission.id,
        revisions: [submission.revision],
        textByRevision: new Map([[submission.revision, submission.text_md]]),
      },
    ]),
);

const context: SemanticContext = {
  knownDecisionIds: new Set(packetFixture.decisions.map((decision) => decision.id)),
  expectedProblemHash: problemFixture.content_hash,
  confirmedSubmissions,
};

// 规格包中的语义层反例按 type 分派到对应校验器。每个校验器都是纯函数，
// 上下文缺失时跳过检查——因此这里显式传入从夹具构造的可信事实，避免空转通过。
function runSemanticValidator(type: string, value: unknown): SemanticIssue[] {
  switch (type) {
    case 'Packet':
      return validatePacket(value as Packet, context);
    case 'Strategy':
      return validateStrategy(value as Strategy, context);
    case 'Diagnosis':
      return validateDiagnosisEvidence(value as Diagnosis, context);
    case 'Report':
      return validateReport(value as Report);
    case 'TranscriptDraft':
      return validateUntrustedTranscriptDraft(value as TranscriptDraft);
    case 'SelectInput':
      return validateSelectInput(value as SelectInput);
    default:
      throw new Error(`No semantic validator wired for ${type}`);
  }
}

// 分派器对未接线的类型抛固定前缀的 Error。校验器收到 `{}` 这类残缺输入时也会抛错
// （访问 undefined 的属性），因此不能只看"是否抛错"，必须核对错误来源。
const NOT_WIRED_PREFIX = 'No semantic validator wired for';

function hasWiredValidator(type: string): boolean {
  try {
    runSemanticValidator(type, {});
    return true;
  } catch (error) {
    return !(error instanceof Error && error.message.startsWith(NOT_WIRED_PREFIX));
  }
}

const negativeCases = readJson<NegativeCase[]>('negative-cases.json');
const semanticCases = negativeCases.filter((entry) => entry.layer === 'semantic');

describe('语义层反例必须被代码校验拒绝', () => {
  it('规格包提供了语义层反例', () => {
    expect(semanticCases.length).toBeGreaterThan(0);
  });

  it('每个反例的类型都有对应校验器', () => {
    const unwired = semanticCases.filter((entry) => !hasWiredValidator(entry.type));
    expect(unwired.map((entry) => `${entry.id}:${entry.type}`)).toEqual([]);
  });

  for (const entry of semanticCases) {
    it(`${entry.id} 被拒绝`, () => {
      const candidate = withInjectedValue(readJson(entry.base), entry.path, entry.value);
      const issues = runSemanticValidator(entry.type, candidate);
      expect(issues.map((item) => item.code), `${entry.id} 应产生语义问题`).not.toEqual([]);
    });
  }
});

describe('合法夹具必须通过语义校验', () => {
  it('packet.json 通过且其 problem_hash 与 problem.json 一致', () => {
    expect(validatePacket(packetFixture, context)).toEqual([]);
    // 交叉核对：避免 expectedProblemHash 取自 packet 自身造成同义反复。
    expect(packetFixture.problem_hash).toBe(problemFixture.content_hash);
  });

  it('strategy.json 通过', () => {
    expect(validateStrategy(readJson<Strategy>('strategy.json'), context)).toEqual([]);
  });

  it('diagnosis.json 的引文可在已确认提交中找到', () => {
    expect(validateDiagnosisEvidence(readJson<Diagnosis>('diagnosis.json'), context)).toEqual([]);
  });

  it('report.json 通过', () => {
    expect(validateReport(readJson<Report>('report.json'))).toEqual([]);
  });

  it('transcript.json 未被标记确认', () => {
    expect(validateUntrustedTranscriptDraft(readJson<TranscriptDraft>('transcript.json'))).toEqual([]);
  });

  it('select.json 未在 random 模式指定题目', () => {
    expect(validateSelectInput(readJson<SelectInput>('select.json'))).toEqual([]);
  });
});

describe('校验器在缺少可信上下文时不得假装通过', () => {
  it('未提供已确认提交时证据校验跳过而非报错', () => {
    const diagnosis = readJson<Diagnosis>('diagnosis.json');
    expect(validateDiagnosisEvidence(diagnosis, {})).toEqual([]);
    // 同一份数据在提供上下文时依然通过，说明上面的空数组来自"跳过"，不是"查不到"。
    expect(validateDiagnosisEvidence(diagnosis, context)).toEqual([]);
  });

  it('提供空提交表时同一诊断被拒绝', () => {
    const diagnosis = readJson<Diagnosis>('diagnosis.json');
    const issues = validateDiagnosisEvidence(diagnosis, { confirmedSubmissions: new Map() });
    expect(issues.map((item) => item.code)).toEqual(['EVIDENCE_UNKNOWN_SUBMISSION']);
  });

  it('未提供 expectedProblemHash 时不做哈希比对', () => {
    const wrongHash = { ...packetFixture, problem_hash: 'a'.repeat(64) } as Packet;
    expect(validatePacket(wrongHash, {})).toEqual([]);
    expect(validatePacket(wrongHash, context).map((item) => item.code)).toEqual(['PACKET_HASH_MISMATCH']);
  });

  it('未提供 knownDecisionIds 时不做归属比对', () => {
    const unknownDecision = { ...readJson<Strategy>('strategy.json'), allowed_disclosures: ['ghost'] } as Strategy;
    expect(validateStrategy(unknownDecision, {})).toEqual([]);
    expect(validateStrategy(unknownDecision, context).map((item) => item.code)).toEqual([
      'STRATEGY_DISCLOSURE_UNKNOWN_DECISION',
    ]);
  });
});
