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
