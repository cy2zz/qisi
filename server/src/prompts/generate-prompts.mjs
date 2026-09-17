// 生成器：server/src/prompts/*.md -> server/src/prompts/index.ts
//
// 解决的问题：server/package.json 的 build 只跑 `tsc -p tsconfig.build.json`，
// 没有任何资源拷贝步骤。因此 server/src/prompts/preparation.md 在 dist/ 中不存在，
// 运行时 fs.readFile 必然 ENOENT（start:prod 与 Docker 镜像都会挂）。
//
// 处理方式：
//   * .md 保留在 agents.json 声明的路径（server/src/prompts/<role>.md），满足契约；
//   * 正文另以 TS 常量落到本文件，供运行时与构建产物使用（tsc 会编译 .ts）；
//   * prompts.spec.ts 三方比对 .ts / 本地 .md / 规格包 .md，杜绝漂移。
//
// 用法（仓库根）：node server/src/prompts/generate-prompts.mjs
//
// eslint 豁免说明：server/eslint.config.mjs 只为 `**/*.ts` 注入 globals.node，
// 而本文件是 .mjs，故 node 全局量需在此单独声明。eslint.config.mjs 属 A 的公共配置，
// 不因本脚本改动。

/* eslint-disable no-undef -- 见上方说明：node globals 未对本 .mjs 注入 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// 与 agents.json 的六项一一对应。vision 归 A03 的转写业务，B01 不纳入。
const ROLES = ['preparation', 'diagnosis', 'strategy', 'assessment', 'renderer', 'guard'];

// 标题形如：`# preparation角色系统提示规范｜prompt-v3.0`
const VERSION_PATTERN = /｜\s*(prompt-v[\d.]+)\s*$/m;

function loadPrompt(role) {
  const text = readFileSync(path.join(here, `${role}.md`), 'utf8');
  const match = VERSION_PATTERN.exec(text);
  if (!match) {
    throw new Error(`${role}.md 中未找到 prompt 版本标识（期望形如「｜prompt-v3.0」）`);
  }
  return { version: match[1], body: text };
}

function main() {
  const prompts = ROLES.map((role) => [role, loadPrompt(role)]);
  const versions = new Set(prompts.map(([, prompt]) => prompt.version));
  if (versions.size !== 1) {
    throw new Error(`六份角色提示的版本不一致：${[...versions].join(', ')}`);
  }
  const [promptVersion] = versions;

  const entries = prompts
    .map(([role, prompt]) => {
      // 用 JSON.stringify 转义：正文含反引号、${} 与中文引号，模板字面量不安全。
      return `  ${role}: {\n    version: ${JSON.stringify(prompt.version)},\n    body: ${JSON.stringify(prompt.body)},\n  },`;
    })
    .join('\n');

  const content = `// 本文件由 server/src/prompts/generate-prompts.mjs 自动生成，请勿手工编辑。
// 重新生成：node server/src/prompts/generate-prompts.mjs
//
// 正文来源为同目录下的 <role>.md（逐字节等同 qisi-sdd-v3/prompts/<role>.md）。
// .md 是给人读的规格来源，本文件是给运行时用的构建产物——因为 npm run build
// 只跑 tsc、不拷贝 .md，dist/ 中不会有 .md 文件。
//
// 角色权限边界（allowed_context_tools / forbidden）不由提示词承载，见
// qisi-sdd-v3/contracts/agents.json 与 server/src/agents/context.ts 的上下文投影。

export type AgentRole = ${ROLES.map((role) => `'${role}'`).join(' | ')};

export const PROMPT_VERSION = ${JSON.stringify(promptVersion)};

export interface RolePrompt {
  readonly version: string;
  readonly body: string;
}

export const ROLE_PROMPTS: Readonly<Record<AgentRole, RolePrompt>> = {
${entries}
};

export const AGENT_ROLES: readonly AgentRole[] = [${ROLES.map((role) => `'${role}'`).join(', ')}];
`;

  writeFileSync(path.join(here, 'index.ts'), content, 'utf8');
  console.log(`generated ${ROLES.length} role prompts (${promptVersion}) -> server/src/prompts/index.ts`);
}

main();
