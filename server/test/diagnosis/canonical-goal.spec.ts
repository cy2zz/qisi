import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Decision, GuardResult, Packet, Strategy } from '../../src/contracts/domain.schema.js';
import { CanonicalGoalRegistry } from '../../src/features/tutor/probe-counter.js';
import { TurnWorkflow } from '../../src/workflows/turn.js';
const packet = JSON.parse(readFileSync(new URL('../../../qisi-sdd-v3/fixtures/packet.json', import.meta.url), 'utf8')) as Packet;
const strategy = JSON.parse(readFileSync(new URL('../../../qisi-sdd-v3/fixtures/strategy.json', import.meta.url), 'utf8')) as Strategy;
const guard = JSON.parse(readFileSync(new URL('../../../qisi-sdd-v3/fixtures/guard.json', import.meta.url), 'utf8')) as GuardResult;
const base = packet.decisions[0]!;
function node(id: string, parent: string | null): Decision {
  return { ...base, id, goal_key: id, parent_goal_key: parent };
}
describe('AT22 canonical probe budget', () => {
  it('resolves deep compensation chains independently of input order', () => {
    const registry = new CanonicalGoalRegistry();
    const root = node('root', null), child = node('child', 'root'), leaf = node('leaf', 'child');
    registry.register('task', [leaf, child, root]);
    expect(registry.resolve('task', leaf)).toBe(registry.resolve('task', root));
  });
  it('rejects cyclic canonical parents', () => {
    expect(() => new CanonicalGoalRegistry().register('task', [node('a', 'b'), node('b', 'a')])).toThrow();
  });
  it('never strips the probe to approve an already-rendered third question', () => {
    const workflow = new TurnWorkflow(); workflow.registerTask(strategy.task_id, packet.decisions);
    const params = { sessionId: 's', taskId: strategy.task_id, decisions: packet.decisions, strategy };
    for (let i = 0; i < 2; i++) {
      const context = workflow.buildStrategyContext(params);
      workflow.recordCommittedProbe({ sessionId: 's', taskId: strategy.task_id, context });
    }
    const context = workflow.buildStrategyContext(params);
    expect(workflow.gate({ strategy, guard, knownDecisionIds: new Set(packet.decisions.map(d => d.id)), context }).approved).toBe(false);
  });
});
