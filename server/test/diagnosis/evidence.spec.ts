import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DiagnosisAgent } from '../../src/agents/diagnosis/index.js';
import type { Diagnosis, DiagnosisInput, Packet, Submission } from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`, import.meta.url), 'utf8')) as T;
}
function setup() {
  const packet = fixture<Packet>('packet');
  const diagnosis = fixture<Diagnosis>('diagnosis');
  const input: DiagnosisInput = {
    task_id: diagnosis.task_id, prompt_md: '自拟题', decisions: packet.decisions, routes: packet.routes,
    confirmed_evidence: fixture<{ submissions: Submission[] }>('session').submissions,
    previous_hypotheses: [], previous_probes: [], private_reference_md: '',
  };
  const provider = new FixtureProvider();
  const run = () => {
    provider.enqueue('diagnosis', { id: 'test', parsed: diagnosis });
    return new DiagnosisAgent().runChecked(input, provider, { model: 'fixture', signal: new AbortController().signal });
  };
  return { diagnosis, input, run };
}

describe('B04 AT19/20/21/23 evidence admission (fixture, not mathematical oracle)', () => {
  it('accepts evidence-grounded competing explanations without conflating judgment and cause', async () => {
    const { run } = setup();
    const result = await run();
    expect(result.value.judgment).toBe('invalid');
    expect(result.value.hypotheses.map(h => h.kind)).toEqual(['concept', 'execution']);
  });
  it.each(['unconfirmed', 'invalidated', 'other-task', 'old-revision'] as const)('rejects %s evidence', async kind => {
    const { input, run } = setup();
    const submission = input.confirmed_evidence.find(s => s.id === 's1')!;
    if (kind === 'unconfirmed') submission.confirmed = false;
    if (kind === 'invalidated') submission.invalidated = true;
    if (kind === 'other-task') submission.task_id = 'other';
    if (kind === 'old-revision') input.confirmed_evidence.push({ ...submission, revision: 2, text_md: '新输入' });
    await expect(run()).rejects.toThrow();
  });
  it('checks nested hypothesis evidence, not just top-level references', async () => {
    const { diagnosis, run } = setup();
    diagnosis.hypotheses[0]!.evidence_refs[0]!.quote = '学生从来没说过';
    await expect(run()).rejects.toThrow();
  });
  it('rejects blank quotes and evidence-free correctness', async () => {
    const { diagnosis, run } = setup();
    diagnosis.evidence_refs = [];
    await expect(run()).rejects.toThrow();
  });
  it('unknown cannot satisfy a decision', async () => {
    const { diagnosis, run } = setup();
    diagnosis.judgment = 'unknown'; diagnosis.satisfied_decision_ids = ['d1'];
    await expect(run()).rejects.toThrow();
  });
  it('cannot invent a different task or focus goal', async () => {
    const { diagnosis, run } = setup(); diagnosis.task_id = 'another-task';
    await expect(run()).rejects.toThrow();
  });
  it.each(['duplicate-hypothesis', 'unknown-hypothesis', 'empty-counter', 'same-expected'] as const)('rejects uninformative probe: %s', async kind => {
    const { diagnosis, run } = setup();
    const branches = diagnosis.probe!.branches;
    if (kind === 'duplicate-hypothesis') branches[1]!.hypothesis_id = branches[0]!.hypothesis_id;
    if (kind === 'unknown-hypothesis') branches[1]!.hypothesis_id = 'invented';
    if (kind === 'empty-counter') branches[1]!.counter_evidence = '  ';
    if (kind === 'same-expected') branches[1]!.expected = branches[0]!.expected;
    await expect(run()).rejects.toThrow();
  });
  it('allows a supported hypothesis to be refuted by new confirmed evidence', async () => {
    const { input, diagnosis, run } = setup();
    input.previous_hypotheses = [{ ...diagnosis.hypotheses[0]!, status: 'supported' }];
    diagnosis.hypotheses[0]!.status = 'refuted';
    await expect(run()).resolves.toBeDefined();
  });
});
