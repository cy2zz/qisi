import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_ROLES, PROMPT_VERSION, ROLE_PROMPTS } from './index.js';

// 规格包只读。路径自 server/src/prompts/ 上溯三级到仓库根。
const specPromptsDirectory = path.resolve(import.meta.dirname, '..', '..', '..', 'qisi-sdd-v3', 'prompts');

describe('提示正文三方一致', () => {
  // 三方：生成的 TS 常量、server/src/prompts/<role>.md、规格包 qisi-sdd-v3/prompts/<role>.md。
  // 存在的理由：build 不拷贝 .md，运行时只能用 TS 常量；若不比对，规格更新后会静默漂移。
  for (const role of AGENT_ROLES) {
    it(`${role} 的 TS 常量与本地 .md 逐字节一致`, () => {
      const local = readFileSync(path.join(import.meta.dirname, `${role}.md`), 'utf8');
      expect(ROLE_PROMPTS[role].body).toBe(local);
    });

    it(`${role} 的本地 .md 与规格包逐字节一致`, () => {
      const local = readFileSync(path.join(import.meta.dirname, `${role}.md`), 'utf8');
      const spec = readFileSync(path.join(specPromptsDirectory, `${role}.md`), 'utf8');
      expect(local).toBe(spec);
    });
  }

  it('本地目录没有多余的 <role>.md', () => {
    const localFiles = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith('.md'))
      .sort();
    expect(localFiles).toEqual([...AGENT_ROLES].map((role) => `${role}.md`).sort());
  });
});

describe('提示版本', () => {
  it('六份提示版本一致且与规格包标题一致', () => {
    expect(PROMPT_VERSION).toBe('prompt-v3.0');
    for (const role of AGENT_ROLES) {
      expect(ROLE_PROMPTS[role].version).toBe(PROMPT_VERSION);
    }
  });

  it('每份正文都声明了不可信数据边界', () => {
    // contracts/README.md §2 与 agents.json 的 forbidden 共同要求：题库与学生内容
    // 一律为不可信数据，且不得调用任意网络/代码执行工具。
    for (const role of AGENT_ROLES) {
      expect(ROLE_PROMPTS[role].body).toContain('不可信数据');
      expect(ROLE_PROMPTS[role].body).toContain('不得调用任意网络/代码执行工具');
    }
  });

  it('六份提示互不相同——不是同一段文字改名字', () => {
    const bodies = new Set(AGENT_ROLES.map((role) => ROLE_PROMPTS[role].body));
    expect(bodies.size).toBe(AGENT_ROLES.length);
  });
});
