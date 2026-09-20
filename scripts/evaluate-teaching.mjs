// B08 offline evidence accounting. No provider calls, uploads or automatic human ratings.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const STRONG_SOCRATIC_BASELINE = `你是高三数学教师。只使用调用方提供的同一题目、数学参考、已确认当前修订证据和帮助历史。先让学生自主尝试；以证据区分不知道、表述不清、计算失误与概念误解；证据不足明确待定。接受有效异解，围绕卡点选最少的高价值启发，不预先给完整路线。同一稳定目标最多两次有区分度探针；学生要求最小提示或直接讲解时尊重选择。保持关键决策由学生完成，真实披露必须记录，不把带帮助答案宣称为独立学会。未确认OCR、未来检验题答案、私有提示与隐藏思维链不得展示。所有调用/修复/失败共用相同总token和时间预算。`;
const ARMS = ['multi_agent', 'socratic'];
const STATUSES = ['completed', 'preparation_failed', 'timeout', 'unknown', 'failed'];
export const COUNTERS = ['diagnosis_opportunities','diagnosis_determinate','diagnosis_correct','diagnosis_unknown','wrong_attributions','interventions_total','interventions_appropriate','unnecessary_questions','decisions_evaluated','independent_decisions','answer_leaks','fabricated_quotes','false_independence','valid_alternative_rejected','unconfirmed_ocr_used','check_attempts','planning_independent_pass','execution_independent_pass','whole_task_independent_pass','helped','skipped','check_unknown','not_tested'];
const CONFIG = ['max_calls','input_tokens_cap','output_tokens_cap','deadline_ms','max_help_level'];
const USAGE = ['calls','input_tokens','output_tokens','elapsed_ms'];
const check = (ok, code) => { if (!ok) throw new Error(code); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
const counterKey = counters => JSON.stringify(COUNTERS.map(k => counters[k]));
function validate(input) {
 check(input?.baseline === 'qisi-3.1' && ['fixture','real_model'].includes(input.provider_mode), 'INVALID_BASELINE_OR_MODE');
 check(input.bank && text(input.bank.version) && count(input.bank.total) && input.bank.total > 0, 'INVALID_BANK');
 check(Array.isArray(input.planned) && input.planned.length > 0 && Array.isArray(input.records), 'EMPTY_OR_INVALID_POPULATION');
 const planned = new Map();
 for (const p of input.planned) {
  check(text(p.case_id) && !planned.has(p.case_id) && text(p.task_id) && /^[a-f0-9]{64}$/.test(p.input_hash) && ['development','holdout'].includes(p.split) && count(p.repetition) && p.repetition >= 1, 'INVALID_PLANNED_CASE');
  planned.set(p.case_id, p);
 }
 check(new Set(input.planned.map(p => p.task_id)).size <= input.bank.total, 'BANK_DENOMINATOR_MISMATCH');
 const seen = new Set();
 for (const r of input.records) {
  const p = planned.get(r.case_id); const key = JSON.stringify([r.case_id, r.arm]);
  check(p && ARMS.includes(r.arm) && !seen.has(key), 'UNKNOWN_OR_DUPLICATE_TRAJECTORY'); seen.add(key);
  check(r.task_id === p.task_id && r.input_hash === p.input_hash, 'SCRIPT_OR_TASK_MISMATCH');
  check(text(r.model) && text(r.prompt_version) && STATUSES.includes(r.status), 'INVALID_EXECUTION_METADATA');
  check(!r.provider_mode || r.provider_mode === input.provider_mode, 'MIXED_PROVIDER_MODES');
  check(r.config && CONFIG.every(k => count(r.config[k])) && r.config.max_calls > 0 && r.config.deadline_ms > 0 && r.config.max_help_level <= 4, 'INVALID_BUDGET');
  check(r.usage && USAGE.every(k => count(r.usage[k])), 'INVALID_USAGE');
  check(Array.isArray(r.reviews) && r.reviews.length <= 2, 'INVALID_REVIEWS');
  const reviewers = new Set();
  for (const review of r.reviews) {
   check(text(review.reviewer_id) && !reviewers.has(review.reviewer_id), 'NONINDEPENDENT_REVIEWERS'); reviewers.add(review.reviewer_id);
   const c = review.counters; check(c && COUNTERS.every(k => count(c[k])), 'INVALID_COUNTERS');
   check(c.diagnosis_correct <= c.diagnosis_determinate && c.diagnosis_determinate + c.diagnosis_unknown <= c.diagnosis_opportunities && c.wrong_attributions <= c.diagnosis_opportunities && c.interventions_appropriate <= c.interventions_total && c.independent_decisions <= c.decisions_evaluated, 'COUNTER_DENOMINATOR_MISMATCH');
   check(['planning_independent_pass','execution_independent_pass','whole_task_independent_pass','helped','skipped','check_unknown'].every(k => c[k] <= c.check_attempts), 'CHECK_DENOMINATOR_MISMATCH');
  }
  check(Array.isArray(r.transcript) && r.transcript.every(m => ['student','teacher','system'].includes(m.speaker) && typeof m.text_md === 'string'), 'INVALID_DISPLAY_TRANSCRIPT');
 }
 return planned;
}
export function evaluateTeaching(input) {
 validate(input);
 const arms = {};
 for (const arm of ARMS) {
  const records = input.records.filter(r => r.arm === arm);
  const counts = Object.fromEntries(COUNTERS.map(k => [k, 0]));
  let agreed = 0, disagreements = 0, pendingReview = 0;
  for (const r of records) {
   if (r.reviews.length < 2) { pendingReview++; continue; }
   if (counterKey(r.reviews[0].counters) !== counterKey(r.reviews[1].counters)) { disagreements++; continue; }
   agreed++; for (const k of COUNTERS) counts[k] += r.reviews[0].counters[k];
  }
  const usage = Object.fromEntries(USAGE.map(k => [k, records.reduce((sum, r) => sum + r.usage[k], 0)]));
  // Include every observed execution, including failed/timeout attempts. Missing runs are not zeroes.
  const elapsed = records.map(r => r.usage.elapsed_ms).sort((a, b) => a - b);
  const percentile = p => elapsed.length ? elapsed[Math.ceil(p * elapsed.length) - 1] : null;
  const latency = { method: 'nearest_rank', observed: elapsed.length, missing: input.planned.length - elapsed.length, p50: percentile(0.5), p95: percentile(0.95) };
  arms[arm] = { planned: input.planned.length, observed: records.length, missing: input.planned.length - records.length,
   statuses: Object.fromEntries(STATUSES.map(s => [s, records.filter(r => r.status === s).length])),
   agreed, disagreements, pending_review: pendingReview, counters: counts, usage, latency_ms: latency,
   budget_overruns: records.filter(r => r.usage.calls > r.config.max_calls || r.usage.input_tokens > r.config.input_tokens_cap || r.usage.output_tokens > r.config.output_tokens_cap || r.usage.elapsed_ms > r.config.deadline_ms).map(r => r.case_id),
   metrics: { diagnosis_accuracy: ratio(counts.diagnosis_correct, counts.diagnosis_determinate), wrong_attribution_rate: ratio(counts.wrong_attributions, counts.diagnosis_opportunities), intervention_appropriateness: ratio(counts.interventions_appropriate, counts.interventions_total), independent_decision_rate: ratio(counts.independent_decisions, counts.decisions_evaluated), planning_independent_pass: ratio(counts.planning_independent_pass, counts.check_attempts), execution_independent_pass: ratio(counts.execution_independent_pass, counts.check_attempts), whole_task_independent_pass: ratio(counts.whole_task_independent_pass, counts.check_attempts) } };
 }
 let comparable = 0; const incomparable = [];
 for (const planned of input.planned) {
  const a = input.records.find(r => r.case_id === planned.case_id && r.arm === ARMS[0]);
  const b = input.records.find(r => r.case_id === planned.case_id && r.arm === ARMS[1]);
  const reason = !a || !b ? 'missing_trajectory' : a.model !== b.model || CONFIG.some(k => a.config[k] !== b.config[k]) ? 'model_or_budget_mismatch' : null;
  if (reason) incomparable.push({ case_id: planned.case_id, reason }); else comparable++;
 }
 return { baseline: input.baseline, provider_mode: input.provider_mode, bank: { version: input.bank.version, total: input.bank.total, sampled_tasks: new Set(input.planned.map(p => p.task_id)).size },
  input_sha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'), arms, comparable_pairs: comparable, incomparable,
  teaching_advantage: 'not_established', student_learning: 'not_evaluated', delayed_transfer: 'not_evaluated',
  limitations: ['Tool validates supplied evidence accounting, not authenticity of human identities or model traces.', 'Failures, missing trajectories, pending reviews and disagreements remain visible. Ratios use agreed scored opportunities only.', 'Aggregate metrics include incomparable arms; they must not be presented as a paired improvement estimate.', 'Fixture reviews are synthetic. Real quality requires the frozen bank sample, risk repetitions and two actual blinded reviewers.'] };
}
export function blindTeaching(input, salt) {
 validate(input); check(typeof salt === 'string' && salt.length >= 32, 'BLINDING_SALT_TOO_SHORT');
 return input.records.map(r => ({ blind_id: createHmac('sha256', salt).update(JSON.stringify([r.case_id, r.arm])).digest('hex'),
  messages: r.transcript.map(m => ({ speaker: m.speaker, text_md: m.text_md })) })).sort((a, b) => a.blind_id.localeCompare(b.blind_id));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const file = process.argv[2];
  if (!file || file === '--help') console.log(`Usage: node scripts/evaluate-teaching.mjs <local-evidence.json> [--blind]
Blind mode reads QISI_EVAL_BLIND_SALT; outputs only display transcripts. No network/model calls.`);
  else {
   const input = JSON.parse(readFileSync(file, 'utf8'));
   const result = process.argv.includes('--blind') ? blindTeaching(input, process.env.QISI_EVAL_BLIND_SALT) : evaluateTeaching(input);
   console.log(JSON.stringify(result, null, 2));
  }
 } catch { console.error('EVALUATION_INPUT_INVALID: check the local schema/protocol; input contents omitted.'); process.exitCode = 1; }
}
