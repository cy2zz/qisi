// Port specification, to be implemented in qisi-dashboard; no provider credentials in client code.
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
export interface SqlTransaction {
  execute<Row = Record<string, unknown>>(sql: string, params: readonly unknown[]): Promise<{ rows: Row[]; affectedRows: number }>;
}
export interface ActiveRunContext {
  runId: string; leaseToken: string; reservedVersion: number | null; deadlineAt: string;
}
export interface StorePort {
  reserve(input: {sessionId:string; requestId:string; expectedVersion:number; payloadHash:string; workflow:string}): Promise<{runId:string; leaseToken:string; reservedVersion:number; deadlineAt:string}>;
  getReusableNode(runId:string, nodeKey:string, inputHash:string): Promise<unknown|null>;
  saveNode(runId:string, leaseToken:string, nodeKey:string, inputHash:string, result:unknown): Promise<void>;
  commitChecked(runId:string, leaseToken:string, reservedVersion:number, checkedMutation:unknown): Promise<unknown>;
  revoke(sessionId:string): Promise<void>;
  // Server-only; owner is derived from trusted context. Never a model/client tool.
  // Locks/validates session -> run before executing a bounded SQL callback.
  withActiveRun<T>(input: ActiveRunContext, work: (tx: SqlTransaction) => Promise<T>): Promise<T>;
  // Resolve succeeded requests BEFORE invoking/resuming a graph, including post-commit checkpoint failure.
  getCommittedResult(runId: string): Promise<unknown | null>;
  // Conditional takeover of an unfinished non-expired run; rotates fencing lease, never resurrects deleted data.
  claimRecovery(runId: string): Promise<ActiveRunContext | null>;
}
// All unknown values MUST pass strict schemas and semantic policy before persistence/projection.
// The infrastructure derives owner from authenticated server context, never ModelRequest or client input.
// MySqlCheckpointSaver uses withActiveRun for writes; only StorePort.commitChecked commits public teaching state.
// Exact driver/graph adapters are A01/B01 work; this file is not an installed implementation.
