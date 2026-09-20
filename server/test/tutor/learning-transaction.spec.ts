import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service.js';
import { LearningSessionService } from '../../src/features/learning/learning-session.service.js';

// SQL boundary recorder, deliberately NOT a database/emulator. It cannot prove MySQL transactions.
function database(options: { expired?: boolean; lostLease?: boolean; foreignRun?: boolean } = {}) {
  const locks: string[] = [];
  const writes: Array<{table:string; values:unknown}> = [];
  const session = { id:'91', user_id:'7', phase:'learning', version:1, active_run_id:'run-1', expires_at:new Date(Date.now() + (options.expired ? -1 : 60_000)), next_message_seq:1, next_event_seq:1 };
  const run = { session_id:options.foreignRun?'92':'91', user_id:'7', status:'active', request_id:'req-1', reserved_version:1, deadline_at:new Date(Date.now()+60_000), lease_token:'lease-1' };
  const chain = (table:string, write=false) => {
    const query = {
      selectAll:()=>query, select:()=>query, where:()=>query, forUpdate:()=>{locks.push(table);return query;}, orderBy:()=>query,
      values:(values:unknown)=>{writes.push({table,values});return query;},
      set:(values:unknown)=>{writes.push({table,values});return query;},
      execute:async()=> write ? { numUpdatedRows: options.lostLease ? 0n : 1n } : [],
      executeTakeFirst:async()=>write ? {numUpdatedRows: options.lostLease ? 0n : 1n} : table==='sessions'?session:table==='runs'?run:undefined,
      executeTakeFirstOrThrow:async()=>({ numUpdatedRows: options.lostLease ? 0n : 1n }),
    };
    return query;
  };
  const tx = { selectFrom:(table:string)=>chain(table), updateTable:(table:string)=>chain(table,true), insertInto:(table:string)=>chain(table,true), deleteFrom:(table:string)=>chain(table,true) };
  const db = { client:{ transaction:()=>({execute:(fn:(trx:typeof tx)=>unknown)=>fn(tx)}) } } as unknown as DatabaseService;
  return { service:new LearningSessionService(db), writes, locks };
}
const commit = { assistanceMode:'attempt' as const, leaseToken:'lease-1', message:'先求导数', reply:'请说明依据', ownerId:'7', requestId:'req-1', runId:'run-1', sessionId:'91', expectedVersion:1 };

describe('A learning transaction guards for B integration (SQL boundary mock)', () => {
  it('rejects a session which expires during the model call before writing messages', async () => {
    const h=database({expired:true});
    await expect(h.service.commitTurn(commit)).rejects.toThrow();
    expect(h.writes).toEqual([]);
  });
  it('rejects a run belonging to another session even if run/version/token match', async () => {
    const h=database({foreignRun:true});
    await expect(h.service.commitTurn(commit)).rejects.toThrow();
    expect(h.writes).toEqual([]);
  });
  it('locks the session before the run when failing, matching reserve and commit lock order', async () => {
    const h=database();
    await h.service.failTurn(commit);
    expect(h.locks[0]).toBe('sessions');
  });
  it('does not finalize the request or clear the session after losing the run lease', async () => {
    const h=database({lostLease:true});
    await h.service.failTurn(commit);
    expect(h.writes.filter(write=>write.table==='requests'||write.table==='sessions')).toEqual([]);
  });
});
