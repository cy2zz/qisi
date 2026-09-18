// 生成器：qisi-sdd-v3/contracts/domain.schema.json -> server/src/contracts/domain.schema.ts
//
// 为什么用生成而不是运行时解释 JSON Schema：
//   Zod 的 z.infer 需要显式 schema 字面量才能做类型推导。若改为运行时解释器，
//   全部领域类型会退化成 z.ZodType<unknown>，丢掉 server/src/config/env.ts 既有
//   的 `z.infer` 范式，也失去编译期字段名检查。
//
// 为什么不是 .ts：tsconfig.json 无 include/exclude，会覆盖 server/ 下全部 .ts。
//   用 .mjs 可让 tsc 与 eslint（只匹配 **/*.ts）都跳过本文件，发布产物不含生成器。
//
// 用法（仓库根）：node server/src/contracts/generate-zod.mjs
//
// 规格包 qisi-sdd-v3/** 受 .gitattributes 的 `-text` 保护，本脚本只读不写。
//
// eslint 豁免说明：server/eslint.config.mjs 只为 `**/*.ts` 注入 globals.node，
// 而本文件是 .mjs，故 node 全局量需在此单独声明。eslint.config.mjs 属 A 的公共配置，
// 不因本脚本改动。

/* eslint-disable no-undef -- 见上方说明：node globals 未对本 .mjs 注入 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..', '..');
const sourcePath = path.join(repositoryRoot, 'qisi-sdd-v3', 'contracts', 'domain.schema.json');
const targetPath = path.join(here, 'domain.schema.ts');

// JSON Schema 的 `Error` 与 TypeScript 全局 Error 同名，导出为同名类型会遮蔽内建 Error。
// 生成时统一改名，映射表其余 Def 保持原名。
const typeAliases = { Error: 'DomainError' };

const text = (value) => JSON.stringify(value);

function schemaConstName(defName) {
  return `${defName}Schema`;
}

function typeName(defName) {
  return typeAliases[defName] ?? defName;
}

function refName(ref) {
  const match = /^#\/\$defs\/(.+)$/.exec(ref);
  if (!match) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  return match[1];
}

// 收集某个 schema 直接引用到的 Def 名，用于拓扑排序。
function collectRefs(node, into) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into);
    return into;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') into.add(refName(value));
      else collectRefs(value, into);
    }
  }
  return into;
}

function literalUnion(values) {
  if (values.length === 1) return `z.literal(${text(values[0])})`;
  return `z.enum([${values.map(text).join(', ')}])`;
}

const indent = (depth) => '  '.repeat(depth);

function renderObject(schema, depth) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(properties).map(([key, value]) => {
    const rendered = render(value, depth + 1);
    const optional = required.has(key) ? '' : '.optional()';
    return `${indent(depth + 1)}${key}: ${rendered}${optional},`;
  });

  if (schema.additionalProperties !== false) {
    throw new Error('Only additionalProperties:false is supported');
  }
  if (lines.length === 0) return 'z.strictObject({})';
  return `z.strictObject({\n${lines.join('\n')}\n${indent(depth)}})`;
}

function renderString(schema) {
  const base = schema.format === 'date-time' ? 'z.iso.datetime()' : 'z.string()';
  const chained = [];
  if (typeof schema.minLength === 'number') chained.push(`.min(${schema.minLength})`);
  if (typeof schema.maxLength === 'number') chained.push(`.max(${schema.maxLength})`);
  if (typeof schema.pattern === 'string') chained.push(`.regex(new RegExp(${text(schema.pattern)}))`);
  return base + chained.join('');
}

function renderNumber(schema) {
  const chained = [];
  if (typeof schema.minimum === 'number') chained.push(`.min(${schema.minimum})`);
  if (typeof schema.maximum === 'number') chained.push(`.max(${schema.maximum})`);
  return 'z.int()' + chained.join('');
}

function renderArray(schema, depth) {
  const chained = [];
  if (typeof schema.minItems === 'number') chained.push(`.min(${schema.minItems})`);
  if (typeof schema.maxItems === 'number') chained.push(`.max(${schema.maxItems})`);
  return `z.array(${render(schema.items, depth)})` + chained.join('');
}

// 可空在规格包中一律写作 anyOf:[X, {type:'null'}]，没有 type:[...] 数组形式。
function renderAnyOf(schema, depth) {
  const isNullable =
    schema.anyOf.length === 2 &&
    schema.anyOf.some((branch) => branch.type === 'null') &&
    schema.anyOf.filter((branch) => branch.type !== 'null').length === 1;

  if (isNullable) {
    const inner = schema.anyOf.find((branch) => branch.type !== 'null');
    return `${render(inner, depth)}.nullable()`;
  }
  return `z.union([${schema.anyOf.map((branch) => render(branch, depth)).join(', ')}])`;
}

function render(schema, depth = 0) {
  if (schema === null || typeof schema !== 'object') {
    throw new Error(`Unsupported schema node: ${text(schema)}`);
  }
  if (typeof schema.$ref === 'string') {
    return `${schemaConstName(refName(schema.$ref))}`;
  }
  if ('const' in schema) return `z.literal(${text(schema.const)})`;
  if (Array.isArray(schema.enum)) return literalUnion(schema.enum);
  if (Array.isArray(schema.anyOf)) return renderAnyOf(schema, depth);

  switch (schema.type) {
    case 'object':
      return renderObject(schema, depth);
    case 'string':
      return renderString(schema);
    case 'integer':
      return renderNumber(schema);
    case 'boolean':
      return 'z.boolean()';
    case 'array':
      return renderArray(schema, depth);
    default:
      throw new Error(`Unsupported type: ${text(schema.type)} in ${text(schema).slice(0, 200)}`);
  }
}

// 拓扑排序：被引用的 Def 先声明，避免模块求值期引用未初始化的 const。
// 出现环时退化为 z.lazy()，本规格包当前无环，但保留该分支以防规格演进。
function orderDefinitions(definitions) {
  const dependencies = new Map();
  for (const [name, schema] of Object.entries(definitions)) {
    const refs = collectRefs(schema, new Set());
    refs.delete(name);
    dependencies.set(name, refs);
  }

  const ordered = [];
  const state = new Map();
  const cycles = new Set();

  const visit = (name, trail) => {
    const current = state.get(name);
    if (current === 'done') return;
    if (current === 'visiting') {
      for (const node of trail.slice(trail.indexOf(name))) cycles.add(node);
      return;
    }
    state.set(name, 'visiting');
    for (const dependency of dependencies.get(name) ?? []) {
      if (dependencies.has(dependency)) visit(dependency, [...trail, name]);
    }
    state.set(name, 'done');
    ordered.push(name);
  };

  for (const name of Object.keys(definitions)) visit(name, []);
  return { ordered, cycles };
}

function main() {
  const document = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const definitions = document.$defs;
  const { ordered, cycles } = orderDefinitions(definitions);

  if (cycles.size > 0) {
    throw new Error(
      `Circular $ref detected (${[...cycles].join(', ')}). This generator does not emit z.lazy() yet; ` +
        'add lazy resolution before regenerating.',
    );
  }

  const blocks = ordered.map((name) => {
    const rendered = render(definitions[name]);
    const alias = typeName(name);
    return [
      `// ${name}`,
      `export const ${schemaConstName(name)} = ${rendered};`,
      `export type ${alias} = z.infer<typeof ${schemaConstName(name)}>;`,
    ].join('\n');
  });

  const exportList = ordered.map(schemaConstName).sort();
  const typeList = ordered.map(typeName).sort();

  const header = [
    '// 本文件由 server/src/contracts/generate-zod.mjs 自动生成，请勿手工编辑。',
    '// 来源：qisi-sdd-v3/contracts/domain.schema.json（48 个 $defs，只读规格包）。',
    '// 重新生成：node server/src/contracts/generate-zod.mjs',
    '//',
    '// 结构约束来自该 JSON Schema；引用、数学、授权、曝光与幂等规则不在 Schema 内，',
    '// 见 qisi-sdd-v3/contracts/README.md，由 server/src/contracts/semantic.ts 实现。',
    '//',
    '// 规格包中唯一的重命名：$defs 的 `Error` 导出为 `DomainError`，避免遮蔽 TypeScript 内建 Error。',
    '',
    "import { z } from 'zod';",
    '',
  ].join('\n');

  const footer = [
    '',
    '// 便于按名字动态取用（FixtureProvider 与契约映射测试使用）。',
    `export const SCHEMA_BY_NAME = {\n${ordered
      .map((name) => `  ${name}: ${schemaConstName(name)},`)
      .join('\n')}\n} as const;`,
    '',
    `export const SCHEMA_NAMES = [\n${ordered.map((name) => `  ${text(name)},`).join('\n')}\n] as const;`,
    '',
    `export const SCHEMA_NAME_SET: ReadonlySet<string> = new Set(SCHEMA_NAMES);`,
    '',
    `export type SchemaName = (typeof SCHEMA_NAMES)[number];`,
    '',
    `export const SCHEMA_CONST_NAMES = [\n${exportList.map((n) => `  ${text(n)},`).join('\n')}\n] as const;`,
    '',
    `export type DomainTypeName =\n${typeList.map((n) => `  | '${n}'`).join('\n')};`,
    '',
  ].join('\n');

  writeFileSync(targetPath, `${header}${blocks.join('\n\n')}\n${footer}`, 'utf8');
  console.log(`generated ${ordered.length} schemas -> ${path.relative(repositoryRoot, targetPath)}`);
}

main();
