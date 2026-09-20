import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StrategyAgent } from '../../src/agents/strategy/index.js';
import type { Strategy, StrategyInput } from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
function setup() {
  const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8'));
  const input = read('strategy-input') as StrategyInput;
  const strategy = read('strategy') as Strategy;
  const provider = new FixtureProvider();
  const run = () => {
    provider.enqueue('strategy', { id: 'test', parsed: strategy });
    return new StrategyAgent().runChecked(input, provider, { model: 'fixture', signal: new AbortController().signal });
  };
  return { input, strategy, run };
}
describe('B05 strategy code policy', () => {
  it.each(['condition_check', 'goal_backchain', 'representation_bridge', 'prior_result_bridge', 'counterexample', 'error_localization', 'worked_fade', 'observe'] as const)('admits %s with bounded evidence (not a quality evaluation)', async intervention => {
    const { strategy, run } = setup(); strategy.intervention = intervention;
    await expect(run()).resolves.toBeDefined();
  });
  it.each(['overlap', 'unapproved-fact', 'empty-source', 'spent-probes', 'invented-goal', 'foreign-task', 'unearned-advance', 'hint-escalation', 'forced-probe'] as const)('rejects %s', async kind => {
    const { input, strategy, run } = setup();
    if (kind === 'overlap') strategy.allowed_disclosures = ['d1'];
    if (kind === 'unapproved-fact') strategy.allowed_facts = [{ decision_ids: ['d1'], source_ref: 'reference', text_md: 'private result' }];
    if (kind === 'empty-source') strategy.allowed_facts = [{ decision_ids: [], source_ref: '', text_md: 'private result' }];
    if (kind === 'spent-probes') input.remaining_probes = 0;
    if (kind === 'invented-goal') strategy.focus_goal_key = 'new';
    if (kind === 'foreign-task') strategy.task_id = 'other';
    if (kind === 'unearned-advance') strategy.action = 'advance';
    if (kind === 'hint-escalation') { input.user_action = 'hint'; strategy.scaffold_level = 4; }
    if (kind === 'forced-probe') input.user_action = 'worked_solution';
    await expect(run()).rejects.toThrow();
  });
});
