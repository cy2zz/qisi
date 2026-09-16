"""Specification-only semantic oracles. App must independently implement and test them."""
import hashlib,json

def errors(kind,obj,context):
    out=[]
    def fail(ok,msg):
        if not ok: out.append(msg)
    packet=context['packet']; problem=context['problem']; session=context['session']
    def graph(g):
        ds=g['decisions']; ids=[d['id'] for d in ds]; lookup={d['id']:d for d in ds}
        fail(len(ids)==len(set(ids)), 'duplicate decision ID')
        fail(len({d['goal_key'] for d in ds})==len(ds), 'duplicate canonical goal')
        for d in ds:
            fail(set(d['prerequisite_ids'])<=set(ids),'unknown prerequisite')
            fail(d['id'] not in d['prerequisite_ids'],'self prerequisite')
        active=set(); done=set()
        def visit(k):
            if k in active: return False
            if k in done or k not in lookup: return True
            active.add(k)
            valid=all(visit(x) for x in lookup[k]['prerequisite_ids'])
            active.remove(k);done.add(k);return valid
        fail(all(visit(k) for k in ids),'cyclic prerequisite')
        routes=g['routes'];fail(len({v['id'] for v in routes})==len(routes),'duplicate route ID')
        for rt in routes:
            ri=set(rt['decision_ids']); fail(ri<=set(ids),'route unknown decision')
            fail(set(rt['terminal_ids'])<=ri,'terminal outside route')
            for d in ri&set(ids): fail(set(lookup[d]['prerequisite_ids'])<=ri,'route misses AND prerequisites')
            if rt['source']=='student': fail(bool(rt['evidence_refs']),'student route lacks student evidence')
    def evidence_tree(x):
        if isinstance(x,dict):
            if set(x)=={'submission_id','revision','quote'}:
                sub=next((s for s in session['submissions'] if s['id']==x['submission_id'] and s['revision']==x['revision'] and s['confirmed'] and not s['invalidated']),None)
                fail(sub is not None,'evidence absent/stale/unconfirmed')
                if sub: fail(bool(x['quote']) and x['quote'] in sub['text_md'],'fictional evidence quote')
            for v in x.values(): evidence_tree(v)
        elif isinstance(x,list):
            for v in x:evidence_tree(v)
    def current_graph(task):
        if task==packet['problem_id']: return packet
        return next((v for v in packet['check_tasks'] if v['id']==task),None)
    if kind=='Problem':
        if not obj['asset_ids']:
            canonical=dict(statement_md=obj['statement_md'],source=obj['source'],is_official=obj['is_official'],asset_content_hashes=[])
            digest=hashlib.sha256(json.dumps(canonical,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            fail(digest==obj['content_hash'],'problem hash mismatch')
    if kind in ('Packet','CheckTask'):
        graph(obj)
        if kind=='Packet':
            fail(obj['problem_id']==problem['id'] and obj['problem_hash']==problem['content_hash'],'packet problem/hash mismatch')
            if obj['ready']:
                fail(not obj['blocking_issues'] and bool(obj['verification']) and bool(obj['reference_source']),'ready packet lacks verification or blocked')
                fail(all(v['status']=='pass' for v in obj['verification']),'ready packet verification not pass')
            for check in obj['check_tasks']:
                out.extend(errors('CheckTask',check,context))
                fail(check['source_problem_id']==obj['problem_id'],'check linked to other source')
        elif obj['verified']:
            fail(bool(obj['verification']) and all(v['status']=='pass' for v in obj['verification']),'check not verified')
    if kind in ('Diagnosis','Strategy','DiagnosisInput','StrategyInput','AssessmentInput'):
        evidence_tree(obj)
    if kind in ('Diagnosis','Strategy'):
        g=current_graph(obj['task_id']);fail(g is not None,'unknown task')
        if g:
            ids={d['id'] for d in g['decisions']}; goals={d['goal_key'] for d in g['decisions']}
            if obj['focus_goal_key'] is not None:fail(obj['focus_goal_key'] in goals,'unknown focus goal')
            if kind=='Diagnosis':
                fail(set(obj['satisfied_decision_ids'])<=ids,'unknown satisfied decision')
                if obj['probe']:
                    hs={h['id'] for h in obj['hypotheses']}
                    fail(all(b['hypothesis_id'] in hs for b in obj['probe']['branches']),'unknown probe hypothesis')
            else:
                allowed=set(obj['allowed_disclosures']);reserved=set(obj['reserved_decisions'])
                fail((allowed|reserved)<=ids,'unknown disclosure decision')
                fail(not allowed&reserved,'allowed/reserved overlap')
                for fact in obj['allowed_facts']: fail(set(fact['decision_ids'])<=allowed,'unapproved fact decision')
    if kind=='Report':
        attempts={a['id']:a for a in context.get('attempts',[])}
        for row in obj['attempts']:
            at=attempts.get(row['attempt_id']);fail(at is not None,'report missing source attempt')
            if at:
                exposed=row['help_exposed'] or at['help_exposed'] or any(e['task_id']==row['task_id'] for e in session['exposures'])
                requested=row['assistance_requested'] or at['assistance_requested']
                invalid=row['invalidated'] or at['invalidated']
                eligible=at['first_seen_eligible'] and row['relation']=='near_transfer' and at['relation']=='near_transfer' and not requested and not exposed and not invalid and bool(at['finished_at'])
                fail(row['independent_planning']==bool(eligible and row['planning']=='correct'),'incorrect independent planning')
                fail(row['independent_execution']==bool(eligible and row['execution']=='correct'),'incorrect independent execution')
                fail(row['independent_task_pass']==(row['independent_planning'] and row['independent_execution']),'incorrect combined independence')
    if kind=='CheckAttempt':
        fail(not obj['finished_at'] or bool(obj['plan_locked_at']),'final submitted before plan lock')
        fail(obj['assessment'] is None or bool(obj['finished_at']),'graded before finish')
    if kind=='TranscriptDraft' and obj['confirmed']:
        fail(all(not line['uncertain'] or line['explicitly_confirmed'] for line in obj['lines']),'unresolved uncertain line confirmed')
    if kind=='SelectInput':
        fail((obj['mode']=='random' and obj['problem_id'] is None) or (obj['mode']=='specified' and bool(obj['problem_id'])),'random/chosen ID mismatch')
    return out