import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { SCHEMA_BY_NAME } from './domain.schema.js';

// 夹具直接读规格包，避免复制造成漂移。qisi-sdd-v3/** 受 .gitattributes 的 `-text`
// 保护，本测试只读。路径自 server/src/contracts/ 上溯三级到仓库根。
const fixturesDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'fixtures');

type JsonKey = string | number;

interface FixtureIndexEntry {
  file: string;
  type: string;
}

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
  if (typeof node !== 'object' || node === null) {
    throw new Error(`Cannot descend into ${node === null ? 'null' : typeof node} at ${String(key)}`);
  }
  if (Array.isArray(node)) {
    if (typeof key !== 'number') throw new Error(`Array index must be numeric, got ${String(key)}`);
    return node[key];
  }
  return (node as Record<string, unknown>)[String(key)];
}

function assign(node: unknown, key: JsonKey, value: unknown): void {
  if (typeof node !== 'object' || node === null) {
    throw new Error(`Cannot assign at ${String(key)}`);
  }
  if (Array.isArray(node)) {
    if (typeof key !== 'number') throw new Error(`Array index must be numeric, got ${String(key)}`);
    node[key] = value;
    return;
  }
  (node as Record<string, unknown>)[String(key)] = value;
}

// 复刻规格包负例的注入语义：在 path 指定的位置改写为 value，其余保持不变。
function withInjectedValue(base: unknown, keys: readonly JsonKey[], value: unknown): unknown {
  const copy = structuredClone(base);
  if (keys.length === 0) return value;
  let cursor = copy;
  for (const key of keys.slice(0, -1)) cursor = descend(cursor, key);
  assign(cursor, keys[keys.length - 1] as JsonKey, value);
  return copy;
}

function parseOutcome(schema: ZodType, candidate: unknown) {
  const result = schema.safeParse(candidate);
  return result.success
    ? { accepted: true as const, issues: [] as string[] }
    : {
        accepted: false as const,
        issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      };
}

const index = readJson<FixtureIndexEntry[]>('index.json');
const negativeCases = readJson<NegativeCase[]>('negative-cases.json');

describe('domain.schema 契约映射', () => {
  it('48 个 $defs 全部映射为 Zod schema', () => {
    expect(Object.keys(SCHEMA_BY_NAME)).toHaveLength(48);
  });

  it('夹具索引中的每个类型都能在契约表中解析', () => {
    const resolvable = index.filter((entry) => entry.type in SCHEMA_BY_NAME);
    expect(resolvable.map((entry) => entry.file)).toEqual(index.map((entry) => entry.file));
  });
});

describe('合法夹具必须通过结构校验', () => {
  for (const entry of index) {
    it(`${entry.file} 满足 ${entry.type}`, () => {
      const schema = SCHEMA_BY_NAME[entry.type as keyof typeof SCHEMA_BY_NAME];
      expect(schema, `未在契约表中找到 ${entry.type}`).toBeDefined();

      const outcome = parseOutcome(schema as ZodType, readJson(entry.file));
      expect(outcome.issues, `${entry.file} 应满足 ${entry.type}`).toEqual([]);
    });
  }
});

describe('结构层反例必须被 Zod 拒绝', () => {
  const structuralCases = negativeCases.filter((entry) => entry.layer === 'schema');

  it('规格包提供了结构层反例', () => {
    expect(structuralCases.length).toBeGreaterThan(0);
  });

  for (const entry of structuralCases) {
    it(`${entry.id} 被 ${entry.type} 拒绝`, () => {
      const schema = SCHEMA_BY_NAME[entry.type as keyof typeof SCHEMA_BY_NAME] as ZodType | undefined;
      expect(schema, `未在契约表中找到 ${entry.type}`).toBeDefined();

      const candidate = withInjectedValue(readJson(entry.base), entry.path, entry.value);
      const outcome = parseOutcome(schema as ZodType, candidate);
      expect(outcome.accepted, `${entry.id} 不应通过结构校验`).toBe(false);
    });
  }
});

describe('语义层反例在结构上仍是合法的', () => {
  // 规格分工：Schema 只管结构，引用/数学/授权/曝光规则由代码校验
  // （qisi-sdd-v3/contracts/README.md 第 3 行）。本组断言语义反例不会被 Zod
  // 截住，从而证明 server/src/contracts/semantic.ts 是必需的，而不是冗余。
  const semanticCases = negativeCases.filter((entry) => entry.layer === 'semantic');

  it('规格包提供了语义层反例', () => {
    expect(semanticCases.length).toBeGreaterThan(0);
  });

  for (const entry of semanticCases) {
    it(`${entry.id} 仍然通过结构校验`, () => {
      const schema = SCHEMA_BY_NAME[entry.type as keyof typeof SCHEMA_BY_NAME] as ZodType | undefined;
      expect(schema, `未在契约表中找到 ${entry.type}`).toBeDefined();

      const candidate = withInjectedValue(readJson(entry.base), entry.path, entry.value);
      const outcome = parseOutcome(schema as ZodType, candidate);
      expect(outcome.issues, `${entry.id} 说明结构校验已能拦截，语义层反例失焦`).toEqual([]);
    });
  }
});

describe('负例覆盖两个层次', () => {
  it('schema 与 semantic 两层都有反例', () => {
    const layers = new Set(negativeCases.map((entry) => entry.layer));
    expect([...layers].sort()).toEqual(['schema', 'semantic']);
  });
});
