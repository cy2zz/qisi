// ModelPort：模型 I/O 的唯一入口。
//
// 语义来源 qisi-sdd-v3/contracts/ports.ts（冻结契约）。契约要求
// 「AI SDK Core 或实际 provider SDK 仅经项目 ModelPort / ModelGateway」，
// 且「模型输出只是候选数据，不得执行任意 SQL、直接改学生状态或绕过 PolicyGate」
// （AGENTS.md §7）。
//
// 与冻结契约的一处收紧：ports.ts 将 outputSchema 标为 unknown，此处收紧为
// z.ZodType。任何 Zod schema 都是 unknown 可接受的值，故不构成不兼容；收紧后
// 调用方无法传入结构上无法校验的 schema，符合 B01 F1「不能用宽松反序列化代替」。

import type { z } from 'zod';

export type Role = 'preparation' | 'diagnosis' | 'strategy' | 'assessment' | 'renderer' | 'guard' | 'vision';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ModelImage {
  readonly mime: ImageMime;
  readonly bytes: Uint8Array;
}

export interface ModelRequest {
  readonly role: Role;
  readonly model: string;
  readonly system: string;
  readonly input: unknown;
  readonly images?: readonly ModelImage[];
  readonly outputSchema: z.ZodType;
  readonly maxOutputTokens: number;
  readonly signal: AbortSignal;
}

// usage 可信度分级（runtime.json 与 contracts/README.md §6）：模型不支持精确 usage 时
// 用保守输入估计 + max_output 预留并标 estimated；「未知usage不能绕过预算」。
export type UsageKind = 'reported' | 'estimated' | 'unknown';

export interface ModelUsage {
  readonly input: number;
  readonly output: number;
  readonly kind: UsageKind;
}

export interface ModelResponse {
  readonly parsed: unknown;
  readonly providerRequestId?: string;
  readonly usage: ModelUsage;
  readonly elapsedMs: number;
  readonly provider: string;
  readonly model: string;
}

export interface ModelPort {
  generate(request: ModelRequest): Promise<ModelResponse>;
}
