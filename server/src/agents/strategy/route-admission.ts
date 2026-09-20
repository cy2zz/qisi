import { RoutePatchSchema, type GuardResult, type RoutePatch, type Submission } from '../../contracts/domain.schema.js';
import { applyRoutePatch, type RouteGraph } from '../preparation/route-graph.js';
import { assertEvidenceReferences, currentEvidence, EvidenceAdmissionError } from '../../features/tutor/evidence.js';

/** Structural/evidence admission after a separate private Guard review; not a math proof. */
export function admitReviewedRoute(input: { taskId: string; current: RouteGraph; patch: RoutePatch; guard: GuardResult; submissions: readonly Submission[] }): RoutePatch | null {
 const parsed = RoutePatchSchema.safeParse(input.patch);
 if (!parsed.success) return null;
 const patch = parsed.data;
 if (patch.task_id !== input.taskId || input.guard.verdict !== 'accept' || input.guard.issues.length || !patch.verification.every(v => v.status === 'pass' && v.reference.trim() && v.reviewer_or_model.trim())) return null;
 if (patch.new_routes.some(r => r.math_status !== 'valid')) return null;
 const evidence = currentEvidence(input.taskId, input.submissions);
 try {
   assertEvidenceReferences(patch.evidence_refs, evidence);
   for (const route of patch.new_routes) {
     if (route.source !== 'teacher' && !route.evidence_refs.length) return null;
     assertEvidenceReferences(route.evidence_refs, evidence);
   }
   if (patch.new_decisions.some(d => d.source !== 'teacher') && !patch.evidence_refs.length) return null;
 } catch (error) { if (error instanceof EvidenceAdmissionError) return null; throw error; }
 return applyRoutePatch(input.current, patch).usable ? patch : null;
}
