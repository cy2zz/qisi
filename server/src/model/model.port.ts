export type ModelRole =
  | 'assessment'
  | 'diagnosis'
  | 'guard'
  | 'preparation'
  | 'renderer'
  | 'strategy'
  | 'vision';

export type ModelImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ModelImage {
  bytes: Uint8Array;
  mime: ModelImageMime;
}

export interface ModelRequest {
  /** 显式在线交互配置；仅对已验证模型应用，不改变模型选择。 */
  latencyProfile?: 'interactive';
  images?: readonly ModelImage[];
  input: unknown;
  maxOutputTokens: number;
  model?: string;
  outputSchema?: z.ZodType;
  role: ModelRole;
  signal: AbortSignal;
  system: string;
}

export interface ModelResponse {
  /** 实际发送的推理设置，供私有节点审计追溯；不包含提示或凭据。 */
  reasoningEffort?: 'none';
  outputVerbosity?: 'low';
  latencyProfileVersion?: 'interactive-v1';
  elapsedMs: number;
  model: string;
  parsed: unknown;
  provider: string;
  providerRequestId?: string;
  usage: {
    input: number;
    kind: 'estimated' | 'reported' | 'unknown';
    output: number;
  };
}

export interface ModelPort {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export const MODEL_PORT = Symbol('MODEL_PORT');
import type { z } from 'zod';
