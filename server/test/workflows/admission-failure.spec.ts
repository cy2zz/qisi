// B04/B05 strict admission failures are controlled rejections, never displayable candidates.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosisInputSchema, DiagnosisSchema, StrategyInputSchema, StrategySchema } from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
import { MemoryStore } from '../../src/workflows/memory-store.js';
import { WorkflowOrchestrator, type TurnCommand } from '../../src/workflows/orchestrator.js';

function setup() {
  const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8'));
  const diagnosisInput = DiagnosisInputSchema.parse(read('diagnosis-input'));
  const diagnosis = DiagnosisSchema.parse(read('diagnosis'));
  const strategyInput = StrategyInputSchema.parse(read('strategy-input'));
  const strategy = StrategySchema.parse(read('strategy'));
  const provider = new FixtureProvider();
  const store = new MemoryStore(); store.seedSession('admission', 1);
  const workflow = new WorkflowOrchestrator(store, provider, {
    models: { preparation: 'fixture', diagnosis: 'fixture', strategy: 'fixture', assessment: 'fixture', renderer: 'fixture', guard: 'fixture' }, configHash: 'admission-test',
  });
  const command: TurnCommand = {
    sessionId: 'admission', requestId: 'request', payloadHash: 'hash', expectedVersion: 1,
    diagnosisInput, routeReviewInput: null,
    buildStrategyInput: value => ({ ...strategyInput, diagnosis: value }),
    buildRendererInput: () => { throw new Error('must not render a rejected candidate'); },
    buildGuardInput: () => { throw new Error('must not guard a rejected candidate'); },
    knownDecisionIds: new Set(diagnosisInput.decisions.map(d => d.id)),
    knownGoalKeys: new Set(diagnosisInput.decisions.map(d => d.goal_key)),
    shownProbesFor: () => 0,
  };
  return { provider, store, workflow, command, diagnosis, strategy, strategyInput };
}

describe('strict admission error boundary', () => {
  it.each(['diagnosis', 'strategy', 'spent-probe'] as const)('returns a safe rejected outcome for %s without rendering or committing', async kind => {
    const { provider, store, workflow, command, diagnosis, strategy, strategyInput } = setup();
    if (kind === 'diagnosis') diagnosis.task_id = 'foreign-private-task';
    if (kind === 'strategy') strategy.task_id = 'foreign-private-task';
    if (kind === 'spent-probe') strategyInput.remaining_probes = 0;
    provider.enqueue('diagnosis', { id: 'diagnosis', parsed: diagnosis });
    provider.enqueue('strategy', { id: 'strategy', parsed: strategy });
    const render = vi.spyOn(workflow.renderer, 'run');
    const commit = vi.spyOn(store, 'commitChecked');
    const result = await workflow.turn(command);
    expect(result).toMatchObject({ status: 'rejected', value: null, decision: { approved: false } });
    if (kind === 'spent-probe') expect(result.decision).toMatchObject({ code: 'PROBE_LIMIT_REACHED' });
    expect(JSON.stringify(result)).not.toContain('foreign-private-task');
    expect(render).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    expect(store.sessionVersion('admission')).toBe(1);
    expect(store.lastSafeMessage('admission')).toBeNull();
  });
  it('does not disguise unexpected provider or store failures as a policy rejection', async () => {
    const { workflow, command } = setup();
    const failure = new Error('unexpected infrastructure failure');
    vi.spyOn(workflow.diagnosis, 'runChecked').mockRejectedValue(failure);
    await expect(workflow.turn(command)).rejects.toBe(failure);
  });
});
