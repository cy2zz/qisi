export type ModelRole =
  | 'assessment'
  | 'diagnosis'
  | 'guard'
  | 'preparation'
  | 'renderer'
  | 'strategy'
  | 'vision';

export interface ModelRequest {
  input: string;
  maxOutputTokens: number;
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
