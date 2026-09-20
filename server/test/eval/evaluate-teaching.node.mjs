import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTeaching, blindTeaching } from '../../../scripts/evaluate-teaching.mjs';
const counters = { diagnosis_opportunities: 1, diagnosis_determinate: 1, diagnosis_correct: 1, diagnosis_unknown: 0, wrong_attributions: 0, interventions_total: 1, interventions_appropriate: 1, unnecessary_questions: 0, decisions_evaluated: 1, independent_decisions: 1, answer_leaks: 0, fabricated_quotes: 0, false_independence: 0, valid_alternative_rejected: 0, unconfirmed_ocr_used: 0, check_attempts: 1, planning_independent_pass: 1, execution_independent_pass: 1, whole_task_independent_pass: 1, helped: 0, skipped: 0, check_unknown: 0, not_tested: 0 };
function dataset() {
 const config = { max_calls: 8, input_tokens_cap: 1000, output_tokens_cap: 1000, deadline_ms: 90000, max_help_level: 4 };
 const planned = [{ case_id: 'case1', task_id: 'task1', input_hash: 'a'.repeat(64), split: 'holdout', repetition: 1 }];
 return { baseline: 'qisi-3.1', provider_mode: 'fixture', bank: { version: 'self-fixture', total: 2 }, planned,
  records: ['multi_agent','socratic'].map(arm => ({ case_id: 'case1', task_id: 'task1', input_hash: 'a'.repeat(64), arm, model: 'fixture-1', prompt_version: 'test-1', config, status: 'completed', usage: { calls: 4, input_tokens: 100, output_tokens: 100, elapsed_ms: 100 }, reviews: [{ reviewer_id: 'reviewer-a', counters }, { reviewer_id: 'reviewer-b', counters }], transcript: [{ speaker: 'teacher', text_md: 'Show your next step.' }] })) };
}
test('keeps planned missing and failed trajectories in denominators', () => {
 const input = dataset(); input.planned.push({ ...input.planned[0], case_id: 'missing' }); input.records[0].status = 'timeout';
 const report = evaluateTeaching(input); assert.equal(report.arms.multi_agent.planned, 2); assert.equal(report.arms.multi_agent.missing, 1); assert.equal(report.arms.multi_agent.statuses.timeout, 1); assert.equal(report.bank.total, 2);
});
test('flags unequal models/budgets as incomparable instead of claiming advantage', () => {
 const input = dataset(); input.records[1].model = 'other'; const report = evaluateTeaching(input);
 assert.equal(report.comparable_pairs, 0); assert.equal(report.incomparable.length, 1); assert.equal(report.teaching_advantage, 'not_established');
});
test('retains human disagreement, does not use a synthetic tiebreak', () => {
 const input = dataset(); input.records[0].reviews[1] = { reviewer_id: 'reviewer-b', counters: { ...counters, diagnosis_correct: 0 } };
 const report = evaluateTeaching(input); assert.equal(report.arms.multi_agent.disagreements, 1); assert.equal(report.arms.multi_agent.metrics.diagnosis_accuracy.value, null);
});
test('blind packets exclude system/model/reviewer identifiers and keep display order', () => {
 const packets = blindTeaching(dataset(), 's'.repeat(32)); assert.equal(packets.length, 2);
 assert.doesNotMatch(JSON.stringify(packets), /multi_agent|socratic|fixture-1|reviewer-/);
 assert.equal(packets[0].messages[0].text_md, 'Show your next step.');
});
test('rejects duplicates, invalid counters and empty planned populations', () => {
 const empty = dataset(); empty.planned = []; assert.throws(() => evaluateTeaching(empty));
 const duplicate = dataset(); duplicate.records.push(duplicate.records[0]); assert.throws(() => evaluateTeaching(duplicate));
 const invalid = dataset(); invalid.records[0].reviews[0] = { reviewer_id: 'reviewer-a', counters: { ...counters, diagnosis_correct: 2 } }; assert.throws(() => evaluateTeaching(invalid));
});

test('includes failures in observed latency and reports missing coverage without imputing zero', () => {
 const input = dataset();
 for (const [index, elapsed] of [[2, 400], [3, 1000]]) {
  input.planned.push({ ...input.planned[0], case_id: `case${index}` });
  input.records.push({ ...input.records[0], case_id: `case${index}`, status: index === 3 ? 'timeout' : 'completed', usage: { ...input.records[0].usage, elapsed_ms: elapsed } });
 }
 input.planned.push({ ...input.planned[0], case_id: 'not-run' });
 const report = evaluateTeaching(input);
 assert.deepEqual(report.arms.multi_agent.latency_ms, { method: 'nearest_rank', observed: 3, missing: 1, p50: 400, p95: 1000 });
 const missing = dataset(); missing.records = [];
 assert.deepEqual(evaluateTeaching(missing).arms.multi_agent.latency_ms, { method: 'nearest_rank', observed: 0, missing: 1, p50: null, p95: null });
});
