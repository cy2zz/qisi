import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PacketSchema, type Diagnosis, type TurnInput } from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
import { createPersistentTurnDeps, persistentRequestId } from '../../src/features/tutor/submit-turn.deps.js';
import { TutorService, type TutorSession } from '../../src/features/tutor/tutor.service.js';
import type { LearningTurnFacade } from '../../src/features/tutor/learning-turn.store.js';
import { restorePersistedTeaching, type TeachingEvent } from '../../src/features/tutor/persisted-teaching.js';
import { CanonicalGoalRegistry } from '../../src/features/tutor/probe-counter.js';

const read = (name:string) => JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`,import.meta.url),'utf8'));
const packet=PacketSchema.parse(read('packet'));
const models={preparation:'fixture',diagnosis:'fixture',strategy:'fixture',assessment:'fixture',renderer:'fixture',guard:'fixture'};
const input:TurnInput={session_id:'91',request_id:'raw-request-1',expected_version:1,action:'attempt',text_md:'f′(x)=1+1/x²',transcript_id:null,transcript_revision:null};
const session:TutorSession={id:'91',version:1,phase:'study',problem:read('problem'),packetVersion:packet.version,decisions:packet.decisions,routes:packet.routes,referenceMd:packet.reference_md,checkTask:packet.check_tasks[0]??null,messages:[{id:'s1',role:'student',text_md:input.text_md,created_at:'2026-09-20T00:00:00.000Z'}],currentGoalKey:null,attempt:null,notice:'',canStartCheck:false};
function harness(options:{replay?:boolean; invalid?:boolean}={}) {
  const fixture=new FixtureProvider();
  const diagnosis:Diagnosis=read('diagnosis');
  if(options.invalid) diagnosis.evidence_refs[0]!.quote='unconfirmed quotation';
  fixture.enqueue('diagnosis',{id:'d1',parsed:diagnosis});
  fixture.enqueue('strategy',{id:'s1',parsed:read('strategy')});
  fixture.enqueue('renderer',{id:'r1',parsed:{text_md:'先说明倒数项的求导依据。'}});
  fixture.enqueue('guard',{id:'g1',parsed:read('guard')});
  const generate=vi.spyOn(fixture,'generate');
  const reservation={kind:'reserved' as const,analysis:{overview:'fixture',firstQuestion:'fixture',keyConditions:[],knowledgePoints:[],target:'fixture'},deadlineAt:new Date(Date.now()+60_000).toISOString(),expectedVersion:1,history:[],leaseToken:'lease-1',packetVersion:packet.version,problemMd:session.problem.statement_md,questionId:null,runId:'run-1',teachingState:{exposures:[],probesShownByGoal:{}}};
  const learning={reserveTurn:vi.fn().mockResolvedValue(reservation),recordTurnNode:vi.fn().mockResolvedValue(undefined),
    commitTurn:vi.fn().mockImplementation(async (params:Parameters<LearningTurnFacade['commitTurn']>[0])=>({reply:params.reply,version:2,studentView:params.checkedTeaching?.studentView})),
    failTurn:vi.fn().mockResolvedValue(undefined)};
  const sessions={load:vi.fn().mockResolvedValue(session),save:vi.fn().mockResolvedValue(true)};
  const deps=createPersistentTurnDeps({learning,sessions,modelPort:fixture,models,configHash:'fixture-config'});
  const service=new TutorService(deps);
  return {learning,sessions,service,generate};
}

describe('A facade / B runner adapter (fixture, no MySQL)',()=>{
  it('uses all four roles then exactly one A checked commit, never split save',async()=>{
    const h=harness();
    const result=await h.service.submitTurn(input,'7');
    expect(h.generate.mock.calls.map(([request])=>request.role)).toEqual(['diagnosis','strategy','renderer','guard']);
    expect(h.learning.recordTurnNode).toHaveBeenCalledTimes(4);
    expect(h.learning.commitTurn).toHaveBeenCalledOnce();
    expect(h.sessions.save).not.toHaveBeenCalled();
    expect(result.version).toBe(2);
    expect(JSON.stringify(result)).not.toContain('private_reference_md');
    expect(h.learning.reserveTurn).toHaveBeenCalledWith(expect.objectContaining({ownerId:'7',protocol:'tutor-v1',requestId:persistentRequestId('7',input.request_id)}));
    expect(h.learning.commitTurn).toHaveBeenCalledWith(expect.objectContaining({audit:expect.objectContaining({probeGoalKey:expect.any(String)}),checkedTeaching:expect.objectContaining({canonicalProbeGoalKey:expect.any(String)})}));
  });
  it('replays the exact safe response without another model/commit/exposure',async()=>{
    const h=harness(); const result=await h.service.submitTurn(input,'7');
    h.learning.reserveTurn.mockResolvedValueOnce({kind:'replay',reply:'cached',version:2,studentView:result});
    h.generate.mockClear();h.learning.commitTurn.mockClear();
    await expect(h.service.submitTurn(input,'7')).resolves.toEqual(result);
    expect(h.generate).not.toHaveBeenCalled();expect(h.learning.commitTurn).not.toHaveBeenCalled();
  });
  it('finalizes rejected evidence under the reserved run/lease with no commit',async()=>{
    const h=harness({invalid:true});const result=await h.service.submitTurn(input,'7');
    expect(result.run_status).toBe('failed');expect(h.learning.commitTurn).not.toHaveBeenCalled();
    expect(h.learning.failTurn).toHaveBeenCalledWith(expect.objectContaining({ownerId:'7',runId:'run-1',leaseToken:'lease-1'}));
  });
  it('does not invent a confirmed handwriting submission from half a transcript reference',async()=>{
    const h=harness();await expect(h.service.submitTurn({...input,transcript_id:'4'},'7')).rejects.toThrow();
    expect(h.learning.reserveTurn).not.toHaveBeenCalled();expect(h.generate).not.toHaveBeenCalled();
  });
  it('does not silently route unintegrated dynamic route actions to attempt',async()=>{
    const h=harness();await expect(h.service.submitTurn({...input,action:'propose_route'},'7')).rejects.toThrow(/route workflow/);
    expect(h.learning.reserveTurn).not.toHaveBeenCalled();expect(h.generate).not.toHaveBeenCalled();
  });
  it('keeps long public request IDs bounded and owner/endpoint scoped for SQL',()=>{
    expect(persistentRequestId('7','x'.repeat(128))).toHaveLength(36);
    expect(persistentRequestId('7','a')).not.toBe(persistentRequestId('8','a'));
    expect(persistentRequestId('7','a')).toBe(persistentRequestId('7','a'));
  });
});

describe('committed teaching state restoration',()=>{
  const makeEvent=(type:string,payload:unknown,id:number):TeachingEvent=>({id,subject_id:`request-${id}`,event_type:type,payload_json:payload,invalidated:1,db_create_time:'2026-09-20T00:00:00.000Z'});
  it('does not erase actual help/probes when the source diagnosis is invalidated',()=>{
    const goal=packet.decisions[0]!;
    const rows=[makeEvent('help_exposed',{decisionIds:[goal.id],wholeTask:false},1),makeEvent('diagnostic_probe_shown',{goalKey:goal.goal_key},2),makeEvent('diagnostic_probe_shown',{goalKey:goal.goal_key},3)];
    const restored=restorePersistedTeaching(packet.problem_id,packet.problem_hash,packet.decisions,rows,[]);
    expect(restored.teachingState.exposures).toHaveLength(1);
    const registry=new CanonicalGoalRegistry();registry.register(packet.problem_id,packet.decisions);
    expect(restored.teachingState.probesShownByGoal[registry.resolve(packet.problem_id,goal)]).toBe(2);
  });
  it('fails closed on legacy goals that cannot be reconciled instead of resetting to zero',()=>{
    expect(()=>restorePersistedTeaching(packet.problem_id,packet.problem_hash,packet.decisions,[makeEvent('diagnostic_probe_shown',{goalKey:'old-unmapped-goal'},1)],[])).toThrow(/reconciliation/);
  });
});
