// Opt-in REAL MySQL test. The companion runner creates a new, private loopback instance.
// No .env loading, fallback database, production credentials, or existing-schema migration.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/database/database.factory.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { SqlMigrationProvider } from '../../src/database/sql-migration.provider.js';
import { LearningSessionService } from '../../src/features/learning/learning-session.service.js';
import { DatabaseTutorSessionPort } from '../../src/features/tutor/database-session.port.js';
import { createPersistentTurnDeps, persistentRequestId } from '../../src/features/tutor/submit-turn.deps.js';
import { TutorService } from '../../src/features/tutor/tutor.service.js';
import { PacketSchema, type Diagnosis, type TurnInput } from '../../src/contracts/domain.schema.js';
import { FixtureProvider } from '../../src/model/fixture.provider.js';
import type { ModelPort, ModelRequest } from '../../src/model/ports.js';

const read=(name:string)=>JSON.parse(readFileSync(new URL(`../../../qisi-sdd-v3/fixtures/${name}.json`,import.meta.url),'utf8'));
const problem=read('problem');
const hash=createHash('sha256').update(problem.statement_md).digest('hex');
const packet=PacketSchema.parse({...read('packet'),problem_hash:hash});
const models={preparation:'fixture',diagnosis:'fixture',strategy:'fixture',assessment:'fixture',renderer:'fixture',guard:'fixture'};
const enabled=process.env.QISI_MYSQL_SPEC_TEST==='1';
let db:ReturnType<typeof createDatabase>;
let database:DatabaseService;
let learning:LearningSessionService;
let owner:string;
let stranger:string;

async function newSession() {
  return learning.createSession({ownerId:owner,content:problem.statement_md,problemMd:problem.statement_md,
    analysis:{overview:'Fixture analysis, not an official exam item.',firstQuestion:'Explain the derivative.',keyConditions:[],knowledgePoints:[],target:'fixture'},
    packetVersion:packet.version,preparationStatus:'ready'});
}
function modelFor(input:TurnInput, beforeGuard?:()=>Promise<void>, invalidEvidence=false) {
  const provider=new FixtureProvider();
  const diagnosis:Diagnosis=read('diagnosis');
  const ref={submission_id:`student-${persistentRequestId(owner,input.request_id)}`,revision:input.transcript_revision??1,quote:invalidEvidence?'NOT_CONFIRMED':input.text_md};
  diagnosis.evidence_refs=diagnosis.evidence_refs.map(()=>({...ref}));
  for(const hypothesis of diagnosis.hypotheses) hypothesis.evidence_refs=hypothesis.evidence_refs.map(()=>({...ref}));
  provider.enqueue('diagnosis',{id:'d',parsed:diagnosis});
  provider.enqueue('strategy',{id:'s',parsed:read('strategy')});
  provider.enqueue('renderer',{id:'r',parsed:{text_md:'请先说明倒数项的求导依据。'}});
  provider.enqueue('guard',{id:'g',parsed:read('guard')});
  const requests:ModelRequest[]=[];
  const model:ModelPort={generate:async request=>{requests.push(request);if(request.role==='guard')await beforeGuard?.();return provider.generate(request);}};
  return {model,requests};
}
function inputFor(id:string,version=1):TurnInput {
  return {session_id:id,request_id:randomUUID(),expected_version:version,action:'attempt',text_md:'f′(x)=1+1/x²',transcript_id:null,transcript_revision:null};
}
function serviceFor(model:ModelPort) {
  return new TutorService(createPersistentTurnDeps({learning,sessions:new DatabaseTutorSessionPort(database),modelPort:model,models,configHash:'mysql-fixture-v1'}));
}
async function requestRow(input:TurnInput) {
  return db.selectFrom('requests').selectAll().where('user_id','=',owner).where('request_id','=',persistentRequestId(owner,input.request_id)).executeTakeFirstOrThrow();
}

describe.skipIf(!enabled)('A/B turn conformance on real isolated MySQL (FixtureProvider)',()=>{
  beforeAll(async()=>{
    const e=process.env;const port=Number(e.QISI_MYSQL_SPEC_PORT);const name=e.QISI_MYSQL_SPEC_NAME??'';
    if(e.QISI_MYSQL_SPEC_HOST!=='127.0.0.1'||!/^qisi_spec_[a-z0-9_]+$/.test(name)||!Number.isInteger(port)||port<1024||port===3306||!e.QISI_MYSQL_SPEC_PASSWORD||e.QISI_MYSQL_SPEC_USER!=='qisi_spec') throw Error('refusing non-isolated MySQL target');
    db=createDatabase({DB_HOST:'127.0.0.1',DB_PORT:port,DB_NAME:name,DB_USER:'qisi_spec',DB_PASSWORD:e.QISI_MYSQL_SPEC_PASSWORD,DB_SSL:false,DB_SSL_CA_PATH:'',DB_CONNECTION_LIMIT:4});
    const tables=await sql<{n:number}>`select count(*) as n from information_schema.tables where table_schema=${name}`.execute(db);
    if(Number(tables.rows[0]?.n)!==0)throw Error('refusing non-empty schema');
    const version=(await sql<{version:string}>`select version() as version`.execute(db)).rows[0]!.version;
    if(!/^8\.(0|4)\./.test(version))throw Error('requires MySQL 8.0.x or 8.4.x');
    const migrated=await new Migrator({db,provider:new SqlMigrationProvider(fileURLToPath(new URL('../../db/',import.meta.url)))}).migrateToLatest();
    if(migrated.error)throw migrated.error;
    expect(migrated.results).toHaveLength(19);
    console.info(JSON.stringify({mysql_version:version,migrations:migrated.results?.length,fixture_model:true,real_student:false}));
    database={client:db} as unknown as DatabaseService;learning=new LearningSessionService(database);
    for(const name of ['owner','stranger']) {
      const inserted=await db.insertInto('users').values({username:name,username_normalized:name,cookie_token_hash:randomBytes(32)}).executeTakeFirstOrThrow();
      if(name==='owner')owner=String(inserted.insertId);else stranger=String(inserted.insertId);
    }
    await db.insertInto('packets').values({problem_hash:Buffer.from(hash,'hex'),version:packet.version,problem_id:packet.problem_id,model_id:'fixture',prompt_version:'fixture',config_hash:'fixture',packet_json:JSON.stringify(packet),status:'ready',review_json:'{}'}).execute();
  },60_000);
  afterAll(async()=>{await db?.destroy();});

  it('commits messages/nodes/probes/version/safe response together and replays across new service instances',async()=>{
    const created=await newSession();const input=inputFor(created.id);const first=modelFor(input);
    const view=await serviceFor(first.model).submitTurn(input,owner);
    expect(first.requests.map(r=>r.role)).toEqual(['diagnosis','strategy','renderer','guard']);
    expect(view.version).toBe(2);
    const messages=await db.selectFrom('learning_messages').selectAll().where('session_id','=',created.id).execute();
    expect(messages).toHaveLength(3);expect(messages.at(-1)?.role).toBe('guide');
    const persisted=await db.selectFrom('sessions').selectAll().where('id','=',created.id).executeTakeFirstOrThrow();
    expect(persisted.version).toBe(2);expect(persisted.active_run_id).toBeNull();
    const run=await db.selectFrom('runs').selectAll().where('session_id','=',created.id).executeTakeFirstOrThrow();
    expect(run.status).toBe('completed');
    expect(await db.selectFrom('node_runs').selectAll().where('run_id','=',run.id).execute()).toHaveLength(4);
    expect(await db.selectFrom('probe_counters').select('shown_count').where('session_id','=',created.id).executeTakeFirstOrThrow()).toEqual({shown_count:1});
    const row=await requestRow(input);expect(row.status).toBe('succeeded');
    expect(JSON.stringify(row.safe_response_json)).not.toContain('private_reference_md');
    const fresh=new DatabaseTutorSessionPort(database);const loaded=await fresh.load(created.id,owner);
    expect(loaded?.messages.at(-1)?.role).toBe('teacher');
    expect(loaded?.messages.at(-1)?.text_md).toBe(view.messages.at(-1)?.text_md);
    expect(loaded?.teachingState?.previousHypotheses.length).toBeGreaterThan(0);
    const second=inputFor(created.id,2);
    await serviceFor(modelFor(second).model).submitTurn(second,owner);
    const callsAfter=first.requests.length;
    await expect(serviceFor(first.model).submitTurn(input,owner)).resolves.toEqual(view);
    expect(first.requests).toHaveLength(callsAfter);
    expect(await db.selectFrom('learning_messages').selectAll().where('session_id','=',created.id).execute()).toHaveLength(5);
    expect((await fresh.load(created.id,owner))?.version).toBe(3);
  });
  it('preserves the two-probe ceiling across fresh runners and records rejection without phantom messages',async()=>{
    const created=await newSession();
    for(let version=1;version<=2;version++){const input=inputFor(created.id,version);await serviceFor(modelFor(input).model).submitTurn(input,owner);}
    const input=inputFor(created.id,3);const third=modelFor(input);const result=await serviceFor(third.model).submitTurn(input,owner);
    expect(result.run_status).toBe('failed');expect(result.version).toBe(3);
    expect((await requestRow(input)).status).toBe('failed');
    expect(await db.selectFrom('probe_counters').select('shown_count').where('session_id','=',created.id).executeTakeFirstOrThrow()).toEqual({shown_count:2});
    expect(await db.selectFrom('learning_messages').selectAll().where('session_id','=',created.id).execute()).toHaveLength(5);
  });
  it('isolates owners and rejects same request ID with different payload before another model call',async()=>{
    const created=await newSession();const input=inputFor(created.id);const h=modelFor(input);const service=serviceFor(h.model);
    await expect(service.submitTurn(input,stranger)).rejects.toThrow();expect(h.requests).toHaveLength(0);
    await service.submitTurn(input,owner);const count=h.requests.length;
    await expect(service.submitTurn({...input,text_md:'different'},owner)).rejects.toThrow(/different content/);
    expect(h.requests).toHaveLength(count);
  });
  it('admits only one same-session concurrent request and commits once',async()=>{
    const created=await newSession();const input=inputFor(created.id);const h=modelFor(input,async()=>{await new Promise(resolve=>setTimeout(resolve,50));});const service=serviceFor(h.model);
    const outcomes=await Promise.allSettled([service.submitTurn(input,owner),service.submitTurn(input,owner)]);
    expect(outcomes.filter(v=>v.status==='fulfilled')).toHaveLength(1);
    expect(h.requests).toHaveLength(4);
    expect(await db.selectFrom('runs').selectAll().where('session_id','=',created.id).execute()).toHaveLength(1);
  });
  it('does not expose requested help when invalid evidence is rejected before rendering',async()=>{
    const created=await newSession();const input={...inputFor(created.id),action:'hint' as const};const h=modelFor(input,undefined,true);
    const result=await serviceFor(h.model).submitTurn(input,owner);expect(result.run_status).toBe('failed');
    expect((await requestRow(input)).status).toBe('failed');
    expect(await db.selectFrom('events').selectAll().where('session_id','=',created.id).where('event_type','=','help_exposed').execute()).toHaveLength(0);
    expect(await db.selectFrom('learning_messages').selectAll().where('session_id','=',created.id).execute()).toHaveLength(1);
  });
  it('does not reset a rejected request by retrying the same ID',async()=>{
    const created=await newSession();const input=inputFor(created.id);const h=modelFor(input,undefined,true);
    const service=serviceFor(h.model);expect((await service.submitTurn(input,owner)).run_status).toBe('failed');
    const calls=h.requests.length;
    await expect(service.submitTurn(input,owner)).rejects.toThrow(/already failed/);
    expect(h.requests).toHaveLength(calls);
    expect(await db.selectFrom('runs').selectAll().where('session_id','=',created.id).execute()).toHaveLength(1);
  });
  it('does not count a help request as help exposure when checked output discloses no solution',async()=>{
    const created=await newSession();const input={...inputFor(created.id),action:'hint' as const};
    const view=await serviceFor(modelFor(input).model).submitTurn(input,owner);expect(view.version).toBe(2);
    expect(await db.selectFrom('events').selectAll().where('session_id','=',created.id).where('event_type','=','help_exposed').execute()).toHaveLength(0);
  });
  it('invalidates stale handwriting evidence but never erases probes already shown',async()=>{
    const created=await newSession();const input=inputFor(created.id);
    const transcript=await db.insertInto('transcripts').values({user_id:owner,session_id:created.id,media_id:null,revision:1,confirmed:1,expires_at:new Date(Date.now()+60_000),lines_json:JSON.stringify([{index:1,text:input.text_md,uncertain:false,explicitly_confirmed:true}])}).executeTakeFirstOrThrow();
    input.transcript_id=String(transcript.insertId);input.transcript_revision=1;
    await serviceFor(modelFor(input).model).submitTurn(input,owner);
    const port=new DatabaseTutorSessionPort(database);
    expect((await port.load(created.id,owner))?.submissions?.[0]?.confirmed).toBe(true);
    await db.updateTable('transcripts').set({revision:2,confirmed:0}).where('id','=',input.transcript_id).execute();
    const loaded=await port.load(created.id,owner);
    expect(loaded?.submissions?.[0]).toMatchObject({confirmed:false,invalidated:true});
    expect(loaded?.teachingState?.previousHypotheses).toEqual([]);
    expect(Object.values(loaded?.teachingState?.probesShownByGoal??{})).toEqual([1]);
  });
  it('fails closed on an unmapped persisted canonical probe counter instead of resetting it',async()=>{
    const created=await newSession();
    await db.insertInto('probe_counters').values({session_id:created.id,task_id:packet.problem_id,canonical_goal_key:'legacy-unmapped',shown_count:1}).execute();
    await expect(new DatabaseTutorSessionPort(database).load(created.id,owner)).rejects.toThrow(/reconciliation/);
  });
  it('rejects session expiry during the model call at the final transaction',async()=>{
    const created=await newSession();const input=inputFor(created.id);const h=modelFor(input,async()=>{
      await db.updateTable('sessions').set({expires_at:new Date(Date.now()-10_000)}).where('id','=',created.id).execute();
    });
    await expect(serviceFor(h.model).submitTurn(input,owner)).rejects.toThrow(/lease or version/);
    expect(await db.selectFrom('learning_messages').selectAll().where('session_id','=',created.id).execute()).toHaveLength(1);
  });
  it('rejects handwriting changed while the model was running',async()=>{
    const created=await newSession();const input=inputFor(created.id);
    const transcript=await db.insertInto('transcripts').values({user_id:owner,session_id:created.id,media_id:null,revision:1,confirmed:1,expires_at:new Date(Date.now()+60_000),lines_json:JSON.stringify([{index:1,text:input.text_md,uncertain:false,explicitly_confirmed:true}])}).executeTakeFirstOrThrow();
    input.transcript_id=String(transcript.insertId);input.transcript_revision=1;
    const h=modelFor(input,async()=>{await db.updateTable('transcripts').set({revision:2,confirmed:0}).where('id','=',input.transcript_id!).execute();});
    await expect(serviceFor(h.model).submitTurn(input,owner)).rejects.toThrow(/transcript/);
    expect(await db.selectFrom('learning_messages').selectAll().where('session_id','=',created.id).execute()).toHaveLength(1);
  });
  it('rechecks previous handwriting used as diagnosis context even when the current turn is typed',async()=>{
    const created=await newSession();const first=inputFor(created.id);
    const transcript=await db.insertInto('transcripts').values({user_id:owner,session_id:created.id,media_id:null,revision:1,confirmed:1,expires_at:new Date(Date.now()+60_000),lines_json:JSON.stringify([{index:1,text:first.text_md,uncertain:false,explicitly_confirmed:true}])}).executeTakeFirstOrThrow();
    first.transcript_id=String(transcript.insertId);first.transcript_revision=1;
    await serviceFor(modelFor(first).model).submitTurn(first,owner);
    const second=inputFor(created.id,2);const h=modelFor(second,async()=>{
      await db.updateTable('transcripts').set({revision:2,confirmed:0}).where('id','=',first.transcript_id!).execute();
    });
    await expect(serviceFor(h.model).submitTurn(second,owner)).rejects.toThrow(/transcript/);
    expect(await db.selectFrom('learning_messages').selectAll().where('session_id','=',created.id).execute()).toHaveLength(3);
    expect((await requestRow(second)).status).toBe('failed');
  });
  it('does not resurrect a session deleted while the model was running',async()=>{
    const created=await newSession();const input=inputFor(created.id);const h=modelFor(input,async()=>{await db.deleteFrom('sessions').where('id','=',created.id).where('user_id','=',owner).execute();});
    await expect(serviceFor(h.model).submitTurn(input,owner)).rejects.toThrow();
    expect(await db.selectFrom('sessions').select('id').where('id','=',created.id).execute()).toHaveLength(0);
    expect(await db.selectFrom('requests').select('id').where('session_id','=',created.id).execute()).toHaveLength(0);
  });
  it('leaves a newer lease and its request active when an old worker reports failure',async()=>{
    const created=await newSession();const requestId=randomUUID();const reserved=await learning.reserveTurn({assistanceMode:'attempt',message:'fixture',expectedVersion:1,ownerId:owner,requestId,sessionId:created.id});
    if(reserved.kind!=='reserved')throw Error('expected fresh run');
    await db.updateTable('runs').set({lease_token:'new-lease'}).where('id','=',reserved.runId).execute();
    await learning.failTurn({ownerId:owner,requestId,sessionId:created.id,runId:reserved.runId,leaseToken:reserved.leaseToken});
    const row=await db.selectFrom('requests').select('status').where('user_id','=',owner).where('request_id','=',requestId).executeTakeFirstOrThrow();
    expect(row.status).toBe('in_progress');
    expect((await db.selectFrom('sessions').select('active_run_id').where('id','=',created.id).executeTakeFirstOrThrow()).active_run_id).toBe(reserved.runId);
  });
});
