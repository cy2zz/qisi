import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Strategy, GuardResult } from '../../src/contracts/domain.schema.js';
import { gateTurn } from '../../src/workflows/policy-gate.js';
function setup() {
 const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8'));
 const strategy = read('strategy') as Strategy; strategy.allowed_disclosures = ['d1', 'd2']; strategy.reserved_decisions = ['d3'];
 const guard = read('guard') as GuardResult; guard.actual_disclosed_ids = ['d1']; guard.whole_task_disclosed = false;
 return { strategy, guard, knownDecisionIds: new Set(['d1','d2','d3','d4']), knownGoalKeys: new Set([strategy.focus_goal_key]), probesShownForFocusGoal: 0 };
}
describe('B07 actual exposure accounting', () => {
 it('records actual disclosure, not every approved potential disclosure', () => {
  const outcome = gateTurn(setup()); expect(outcome).toMatchObject({ approved: true, approvedDisclosures: ['d1'] });
 });
 it('does not invent exposure for a neutral question', () => {
  const input = setup(); input.guard.actual_disclosed_ids = []; expect(gateTurn(input)).toMatchObject({ approved: true, approvedDisclosures: [] });
 });
 it.each([-1, NaN, 0.5])('fails closed on invalid durable probe count %s', value => {
  const input = setup(); input.probesShownForFocusGoal = value; expect(gateTurn(input).approved).toBe(false);
 });
});
