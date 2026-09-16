// Port specification, to be implemented in qisi-web; no provider credentials in client code.
export type Role = 'preparation'|'diagnosis'|'strategy'|'assessment'|'renderer'|'guard'|'vision';
export interface ModelRequest {
  role: Role; model: string; system: string; input: unknown;
  images?: { mime: 'image/png'|'image/jpeg'|'image/webp'; bytes: Uint8Array }[];
  outputSchema: unknown; maxOutputTokens: number; signal: AbortSignal;
}
export interface ModelResponse {
  parsed: unknown; providerRequestId?: string;
  usage: { input: number; output: number; kind:'reported'|'estimated'|'unknown' };
  elapsedMs: number; provider: string; model: string;
}
export interface ModelPort { generate(request: ModelRequest): Promise<ModelResponse> }
export interface StorePort {
  reserve(input: {sessionId:string; requestId:string; expectedVersion:number; payloadHash:string; workflow:string}): Promise<{runId:string; leaseToken:string; reservedVersion:number; deadlineAt:string}>;
  getReusableNode(runId:string, nodeKey:string, inputHash:string): Promise<unknown|null>;
  saveNode(runId:string, leaseToken:string, nodeKey:string, inputHash:string, result:unknown): Promise<void>;
  commitChecked(runId:string, leaseToken:string, reservedVersion:number, checkedMutation:unknown): Promise<unknown>;
  revoke(sessionId:string): Promise<void>;
}
// All unknown values MUST pass strict schemas and semantic policy before persistence/projection.
// The infrastructure derives owner from authenticated server context, never ModelRequest or client input.