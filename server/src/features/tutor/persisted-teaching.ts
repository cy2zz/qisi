import { ConflictException } from '@nestjs/common';
import { DiagnosisSchema, ExposureSchema, StrategySchema, type Decision, type Submission } from '../../contracts/domain.schema.js';
import { CanonicalGoalRegistry } from './probe-counter.js';
import { assertEvidenceReferences, EvidenceAdmissionError } from './evidence.js';
import type { TutorSession } from './tutor.service.js';

export function parseStoredJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) as unknown : value;
}
export interface TeachingEvent {
  id: string | number; subject_id: string; event_type: string; payload_json: unknown;
  invalidated: number; db_create_time: Date | string;
}

/** Committed events are facts. Invalidating a diagnosis never erases actual help/probes. */
export function restorePersistedTeaching(taskId: string, contentHash: string, decisions: readonly Decision[], rows: readonly TeachingEvent[], submissions: readonly Submission[]) {
  const registry = new CanonicalGoalRegistry();
  registry.register(taskId, decisions);
  const canonicalKeys = new Set(decisions.map(d => registry.resolve(taskId, d)));
  const state: NonNullable<TutorSession['teachingState']> = {
    exposures: [], probesShownByGoal: {}, previousHypotheses: [], previousProbes: [],
  };
  const exposures = [...state.exposures];
  const counts: Record<string, number> = {};
  let hypotheses = [...state.previousHypotheses];
  const probes = [...state.previousProbes];
  let currentGoalKey: string | null = null;
  for (const row of rows) {
    const stored: unknown = parseStoredJson(row.payload_json);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new ConflictException('invalid persisted teaching event');
    const payload = stored as Record<string, unknown>;
    if (row.event_type === 'help_exposed') {
      const ids = Array.isArray(payload.decisionIds) ? payload.decisionIds.filter((id): id is string => typeof id === 'string') : [];
      const known = new Set(decisions.map(d => d.id));
      // Legacy unscoped help cannot be interpreted as "no help".
      const whole = payload.wholeTask === true || ids.length === 0 || ids.some(id => !known.has(id));
      exposures.push(ExposureSchema.parse({
        id: `event-${row.id}`, task_id: taskId, content_hash: contentHash, turn_id: row.subject_id,
        decision_ids: whole ? [] : ids, scope: whole ? 'whole_task' : 'listed_decisions',
        reason: payload.reason === 'teacher_trace' || payload.reason === 'route_reveal' ? payload.reason
          : payload.assistanceMode === 'worked_solution' ? 'worked_solution' : 'teacher_hint',
        created_at: new Date(row.db_create_time).toISOString(),
      }));
    }
    if (row.event_type === 'diagnostic_probe_shown') {
      const decision = decisions.find(d => d.goal_key === payload.goalKey || d.id === payload.goalKey);
      const key = decision ? registry.resolve(taskId, decision) : payload.canonicalGoalKey;
      if (typeof key !== 'string' || !canonicalKeys.has(key)) {
        throw new ConflictException('persisted probe goals require reconciliation');
      }
      counts[key] = (counts[key] ?? 0) + 1;
      if (counts[key] > 2) throw new ConflictException('persisted probe limit violated');
    }
    if (row.event_type === 'checked_teaching_turn' && row.invalidated === 0) {
      const diagnosis = DiagnosisSchema.parse(payload.diagnosis);
      const strategy = StrategySchema.parse(payload.strategy);
      if (diagnosis.task_id !== taskId) throw new ConflictException('persisted diagnosis task mismatch');
      hypotheses = diagnosis.hypotheses.filter(h => {
        try { assertEvidenceReferences(h.evidence_refs, submissions); return true; } catch (error) {
          if (error instanceof EvidenceAdmissionError) return false;
          throw error;
        }
      });
      if (strategy.probe) probes.push(strategy.probe);
      if (decisions.some(d => d.goal_key === strategy.focus_goal_key)) currentGoalKey = strategy.focus_goal_key;
    }
  }
  return { currentGoalKey, teachingState: { exposures, probesShownByGoal: counts, previousHypotheses: hypotheses, previousProbes: probes } };
}
