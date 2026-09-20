import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { MathMarkdown } from '@/shared/MathMarkdown';
export interface TeacherPageProps { sessionId: string; initialVersion: number }
// This is the safe B06 response, never server SessionState/TraceStep/Packet props.
interface TraceView {
 task_id: string; version: number; limitations: string[];
 traces: { turn_id: string; invalidated: boolean; shown_text_md: string;
  evidence: { submission_id: string; revision: number; quote: string }[];
  diagnosis: { judgment: string; summary: string; hypotheses: { id: string; kind: string; status: string; explanation: string; missing_evidence: string }[] } | null;
  strategy: { intervention: string; scaffold_level: number; decision_reason: string; fading_reason: string; expected_student_artifact: string } | null;
  probe: { question_md: string; ordinal: number; branches: { hypothesis_id: string; expected: string; counter_evidence: string; next_action: string }[] } | null;
 }[];
 runs: { id: string; workflow: string; status: string; calls: { role: string; model: string; prompt_version: string; attempt: number; input_tokens: number; output_tokens: number; usage_kind: string; result_status: string }[] }[];
}
export function TeacherPage(props: TeacherPageProps) { return <TeacherSession key={props.sessionId} {...props} />; }
function TeacherSession({ sessionId, initialVersion }: TeacherPageProps) {
 const [credential, setCredential] = useState(''); const [authenticated, setAuthenticated] = useState(false);
 const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false);
 const [error, setError] = useState(''); const [view, setView] = useState<TraceView | null>(null);
 const version = useRef(initialVersion); const request = useRef<{ id: string; version: number } | null>(null);
 const active = useRef<AbortController | null>(null);
 useEffect(() => () => active.current?.abort(), []);
 async function login(event: FormEvent) {
  event.preventDefault(); if (busy) return;
  const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
  const secret = credential; setCredential('');
  try {
   await apiFetch('/api/teacher/login', { method: 'POST', body: JSON.stringify({ credential: secret }), signal: controller.signal });
   if (!controller.signal.aborted) setAuthenticated(true);
  } catch { if (!controller.signal.aborted) setError('登录失败或请求过于频繁，请核对教师凭据。'); }
  finally { if (!controller.signal.aborted) setBusy(false); }
 }
 async function openTrace() {
  if (busy || !confirmed) return;
  const controller = new AbortController(); active.current = controller; setBusy(true); setError(''); setView(null);
  // Keep the same ID/version after an ambiguous network error; never double-account a retry.
  request.current ??= { id: crypto.randomUUID(), version: version.current };
  try {
   const result = await apiFetch<TraceView>('/api/teacher/trace', { method: 'POST', signal: controller.signal,
    body: JSON.stringify({ session_id: sessionId, expected_version: request.current.version, request_id: request.current.id, confirm_exposure: true }) });
   if (!controller.signal.aborted) { setView(result); version.current = result.version; request.current = null; setConfirmed(false); }
  } catch { if (!controller.signal.aborted) setError('无法打开依据：请检查会话授权、版本或网络。可重试同一请求；版本冲突需返回学生页重新打开。'); }
  finally { if (!controller.signal.aborted) setBusy(false); }
 }
 async function logout() {
  if (busy) return;
  const controller = new AbortController(); active.current = controller; setBusy(true); setError(''); setView(null);
  try { await apiFetch('/api/teacher/logout', { method: 'POST', signal: controller.signal });
   if (!controller.signal.aborted) { setAuthenticated(false); setConfirmed(false); request.current = null; }
  } catch { if (!controller.signal.aborted) setError('退出未确认，请重试。'); }
  finally { if (!controller.signal.aborted) setBusy(false); }
 }
 return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
  <header><h1 className="text-2xl font-semibold">教师决策依据</h1><p className="mt-2 text-sm text-slate-600">仅查看已发生的教学记录。摘要不是模型隐藏思维链，也不证明学生已学会。</p></header>
  {!authenticated ? <form onSubmit={login} className="max-w-md space-y-3">
   <label className="block">教师访问凭据<input aria-label="教师访问凭据" type="password" autoComplete="off" value={credential} onChange={e => setCredential(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
   <button disabled={busy || !credential} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">教师登录</button>
  </form> : <section className="space-y-3 rounded border border-amber-400 bg-amber-50 p-4">
   <p>打开依据会先记录当前任务的整题帮助曝光，此记录不能撤销；不会读取未来检验题或评分答案。</p>
   <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />我确认记录当前任务的帮助曝光</label>
   <div className="flex flex-wrap gap-3"><button onClick={() => void openTrace()} disabled={busy || !confirmed} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">确认曝光并查看</button><button disabled={busy} onClick={() => void logout()} className="rounded border px-4 py-2">退出教师模式</button></div>
  </section>}
  {busy && <p role="status">正在处理…</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
  {view && <section className="space-y-5"><h2 className="text-xl">当前任务：{view.task_id}</h2>
   {view.traces.length === 0 && <p>当前任务暂无教学决策记录。</p>}
   {view.traces.map(trace => <article key={trace.turn_id} className="space-y-3 rounded border p-4">
    <h3 className="font-semibold">教学轮 {trace.turn_id}{trace.invalidated ? ' · 已因输入修订失效' : ''}</h3>
    <div className="grid gap-6 lg:grid-cols-2"><div><h4>学生证据</h4>{trace.evidence.map((e, i) => <div key={`${e.submission_id}:${e.revision}:${i}`}><small>输入 {e.submission_id} · 修订 {e.revision}</small><MathMarkdown content={e.quote} /></div>)}
     {trace.diagnosis && <><h4>诊断与不确定性：{trace.diagnosis.judgment}</h4><p>{trace.diagnosis.summary}</p>{trace.diagnosis.hypotheses.map(h => <div key={h.id} className="my-2 border-l-2 pl-3"><p>{h.kind} · {h.status}</p><p>{h.explanation}</p><p>待补证据：{h.missing_evidence || '未记录'}</p></div>)}</>}
    </div><div>{trace.strategy && <><h4>干预：{trace.strategy.intervention} · L{trace.strategy.scaffold_level}</h4><p>{trace.strategy.decision_reason}</p><p>预期学生产物：{trace.strategy.expected_student_artifact}</p><p>撤架依据：{trace.strategy.fading_reason || '未提出撤架'}</p></>}
     {trace.probe && <><h4>探针 #{trace.probe.ordinal}</h4><MathMarkdown content={trace.probe.question_md} />{trace.probe.branches.map(b => <p key={b.hypothesis_id}>预期：{b.expected}；反证：{b.counter_evidence}；后续：{b.next_action}</p>)}</>}
     <h4>实际展示</h4><MathMarkdown content={trace.shown_text_md} />
    </div></div>
   </article>)}
   <details><summary>实际节点与模型调用记录</summary>{view.runs.map(run => <div key={run.id}><p>{run.workflow} · {run.status}</p>{run.calls.map((c, i) => <p key={i}>{c.role} · {c.model} · {c.prompt_version} · 尝试 {c.attempt} · {c.input_tokens + c.output_tokens} tokens ({c.usage_kind}) · {c.result_status}</p>)}</div>)}</details>
   {view.limitations.map(text => <p key={text} className="text-sm text-slate-600">{text}</p>)}
  </section>}
 </main>;
}
