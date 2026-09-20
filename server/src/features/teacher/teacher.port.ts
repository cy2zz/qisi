import type { RunRecord, TeacherInput, TraceStep } from '../../contracts/domain.schema.js';
export interface TeacherSession { teacherId: string; expiresAt: string }
export interface TraceCommit {
 sessionId: string; taskId: string; version: number;
 exposure: { taskId: string; scope: 'whole_task'; committed: true };
 traces: readonly TraceStep[]; runs: readonly RunRecord[];
}
/** A implements these operations in its single MySQL facade; no production memory fallback. */
export interface TeacherStorePort {
 /** Atomic persistent IP+global login throttle; key is a hash, never a credential. */
 consumeLoginAttempt(rateKey: string, now: string): Promise<boolean>;
 createTeacherSession(tokenHash: string, session: TeacherSession): Promise<void>;
 findTeacherSession(tokenHash: string): Promise<TeacherSession | null>;
 revokeTeacherSession(tokenHash: string): Promise<void>;
 /** MUST recheck teacher expiry, granted session (or matching authenticated owner), Origin,
  * CAS, request hash/idempotency, active task, TTL/deletion inside one short transaction.
  * Persist current-task whole_task exposure + event + replay response BEFORE resolving.
  * Store token hash, never cookie/credential. Matching request replay cannot add exposure.
  * Only return already-occurred current-task traces and their runs, never future packets.
  */
 openTraceChecked(command: { input: TeacherInput; teacherTokenHash: string; teacherId: string; origin: string; ownerToken: string | undefined; payloadHash: string }): Promise<TraceCommit>;
}
export interface TeacherOptions {
 origin: string; secureCookie: boolean; credentialSha256: string; teacherId: string;
}
export const TEACHER_STORE = Symbol('TEACHER_STORE');
export const TEACHER_OPTIONS = Symbol('TEACHER_OPTIONS');
