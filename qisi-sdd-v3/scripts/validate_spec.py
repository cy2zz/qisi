"""Validate SDD artifacts only; never reports application/model/learning success."""
from pathlib import Path
import json,copy,csv,hashlib,sys,datetime
from jsonschema import Draft202012Validator,FormatChecker
from semantic_rules import errors as semantic_errors
R=Path(__file__).resolve().parents[1]
results=[]
def load(p):return json.loads((R/p).read_text(encoding='utf8'))
def check(label,ok,detail=''):
 results.append(dict(check=label,passed=bool(ok),detail=str(detail)))
def unique(rows,key='id'):return len(rows)==len({r[key] for r in rows})
def acyclic(mapping):
 active=set();done=set()
 def visit(k):
  if k in active:return False
  if k in done:return True
  active.add(k)
  if not all(visit(d) for d in mapping.get(k,[])):return False
  active.remove(k);done.add(k);return True
 return all(visit(k) for k in mapping)

required=['README.md','AGENTS.md','design-v6.md','plan.md','prd.md','reuse.md','requirements.json','tasks.json','traceability.csv','runtime.json','reuse-lock.json','scope-changes.json','env.example','contracts/domain.schema.json','contracts/README.md','contracts/database.sql','contracts/ports.ts','contracts/agents.json','contracts/state-transitions.json','contracts/server-functions.json','acceptance/cases.json','acceptance/role-cases.json','acceptance/evaluation-protocol.md','acceptance/result-template.json','fixtures/index.json','fixtures/negative-cases.json','fixtures/branch-cases.json','prompts/developer-a.md','prompts/developer-b.md','prompts/developer-single.md','prompts/vision.md','changes/template.md','handoffs/template.md','requirements-dev.txt','publication/publication-status.json','stack.json','adr/ADR-001-stack.md','contracts/mysql.md','contracts/workflow-persistence.md','acceptance/stack-cases.json','scripts/validate_stack.py','scripts/validate_mysql.py','publication/local-revision-status.json']
for p in required:check('file:'+p,(R/p).is_file())
for p in R.rglob('*'):
 if p.suffix in ('.md','.json','.csv','.py','.ts','.sql') and '__pycache__' not in p.parts and (str(p.relative_to(R)).replace('\\','/') in required or p.relative_to(R).parts[0] in ('contracts','acceptance','fixtures','prompts','changes','handoffs') or p.relative_to(R).as_posix() in ('scripts/validate_spec.py','scripts/semantic_rules.py','scripts/package.py','publication/README.md')):
  try:
   text=p.read_text(encoding='utf8');check('utf8:'+str(p.relative_to(R)),'\ufffd' not in text and not text.startswith('\ufeff'))
  except Exception as e:check('utf8:'+str(p.relative_to(R)),False,e)
reqs=load('requirements.json');tasks=load('tasks.json');cases=load('acceptance/cases.json')
rm={v['id']:v for v in reqs};tm={v['id']:v for v in tasks};cm={v['id']:v for v in cases}
check('requirements 18 unique P0',len(reqs)==18 and unique(reqs) and all(v['priority']=='P0' for v in reqs))
check('tasks 20 unique',len(tasks)==20 and unique(tasks))
check('AT 60 unique specified',len(cases)==60 and unique(cases) and all(v['status']=='specified' and v['result']=='not_run' for v in cases))
for r in reqs:
 check(r['id']+':references',bool(r['tasks']) and bool(r['tests']) and set(r['tasks'])<=tm.keys() and set(r['tests'])<=cm.keys())
 check(r['id']+':reverse task coverage',all(r['id'] in tm[t]['requirements'] for t in r['tasks']))
 check(r['id']+':reverse AT coverage',all(r['id'] in cm[a]['requirements'] for a in r['tests']))
for t in tasks:
 check(t['id']+':card complete',all(k in t for k in ['input','output','write_scope','excluded_write_scope','steps','failure_first','test_commands','handoff_required']) and len(t['steps'])>=3 and t['status']=='planned')
 check(t['id']+':owner/day',t['owner'] in ('A','B') and t['id'].startswith(t['owner']) and 1<=t['day']<=10)
 check(t['id']+':dependencies',set(t['depends_on'])<=tm.keys() and all(tm[d]['day']<=t['day'] for d in t['depends_on']))
 check(t['id']+':coverage',set(t['requirements'])<=rm.keys() and bool(t['acceptance']) and set(t['acceptance'])<=cm.keys())
 check(t['id']+':input files',all((R/p).is_file() for p in t['input']))
 if 'server/src/agents/**' in t['write_scope'] and t['owner']=='B':check(t['id']+':assessment ownership','server/src/agents/assessment/**' in t['excluded_write_scope'])
for owner in ('A','B'):
 rows=[t for t in tasks if t['owner']==owner];check(owner+':ten person-days',sum(t['person_days'] for t in rows)==10 and sorted(t['day'] for t in rows)==list(range(1,11)))
check('dependency DAG',acyclic({t['id']:t['depends_on'] for t in tasks}))
for c in cases:
 check(c['id']+':card and FR refs',c['task'] in tm and c['owner']==tm[c['task']]['owner'] and c['id'] in tm[c['task']]['acceptance'] and set(c['requirements'])<=rm.keys() and all(c[k] for k in ['given','when','then','evidence_path']))
rows=list(csv.DictReader((R/'traceability.csv').open(encoding='utf8',newline='')))
check('traceability nonempty',len(rows)>=18)
schema=load('contracts/domain.schema.json');defs=schema['$defs']
Draft202012Validator.check_schema(schema);check('48 schemas',len(defs)==48)
for name,sub in defs.items():
 check(name+':strict object',sub.get('type')!='object' or (sub.get('additionalProperties') is False and set(sub.get('required',[]))==set(sub.get('properties',{}))))
def validate(kind,obj):
 return list(Draft202012Validator({'$schema':schema['$schema'],'$defs':defs,'$ref':'#/$defs/'+kind},format_checker=FormatChecker()).iter_errors(obj))
context={key:load('fixtures/'+key+'.json') for key in ['problem','packet','session']};context['attempts']=[load('fixtures/check-attempt.json')]
positives=load('fixtures/index.json');check('16 positive fixtures',len(positives)==16)
for f in positives:
 obj=load('fixtures/'+f['file']);es=validate(f['type'],obj);check('positive schema:'+f['file'],not es,'; '.join(e.message for e in es))
 es=semantic_errors(f['type'],obj,context);check('positive semantics:'+f['file'],not es,'; '.join(es))
negatives=load('fixtures/negative-cases.json');check('20 negative fixtures',len(negatives)==20 and unique(negatives))
for n in negatives:
 obj=copy.deepcopy(load('fixtures/'+n['base']));target=obj
 for k in n['path'][:-1]:target=target[k]
 target[n['path'][-1]]=n['value'];es=validate(n['type'],obj)
 if n['layer']=='schema':check('negative schema:'+n['id'],bool(es))
 else:
  check('negative remains schema-valid:'+n['id'],not es,'; '.join(e.message for e in es))
  check('negative semantic:'+n['id'],bool(semantic_errors(n['type'],obj,context)))
agents=load('contracts/agents.json');check('four agents and two modules',len(agents)==6 and len([x for x in agents if x['name'].endswith('Agent')])==4)
for a in agents:
 check(a['name']+':input schema',a['input_schema'] in defs)
 check(a['name']+':output schema',all(k in defs for k in a['output_schema'].split(' or ')))
 prompt=R/'prompts'/Path(a['prompt']).name;check(a['name']+':prompt exists',prompt.is_file())
check('16 server boundaries',len(load('contracts/server-functions.json'))==16)
for b in load('fixtures/branch-cases.json'):check(b['id']+':specified behavior',bool(b['steps']) and bool(b['assertions']) and b['source']=='self_authored_not_student_data')
check('16 behavior cases',len(load('fixtures/branch-cases.json'))==16)
check('six role cases',len(load('acceptance/role-cases.json'))==6)
rt=load('runtime.json');check('no unguarded streaming',rt['public_output_streaming'] is False)
check('probe global limit',rt['probe_limit_per_canonical_goal']==2)
check('role repair bounded',rt['schema_repairs_per_run']==1 and rt['text_rewrites_per_run']==1 and rt['route_reviews_per_turn']==1)
for w,b in rt['workflows'].items():check('budget:'+w,0<b['normal_calls']<=b['max_calls']<=7 and b['deadline_ms']>0 and b['input_tokens_cap']>0 and b['output_tokens_cap']>0)
check('reuse not pretended installed',load('reuse-lock.json')['status']=='planned_not_installed' and all(i['resolved_version'] is None for i in load('reuse-lock.json')['items']))
# MySQL DDL is NOT run by this static validator. Never substitute SQLite semantics.
from validate_stack import inspect as inspect_stack
for result in inspect_stack():check(result['check'],result['passed'])
st=load('acceptance/stack-cases.json');sm={c['id']:c for c in st}
for task in tasks:
 check(task['id']+':stack references',all(k in sm and task['id'] in sm[k]['tasks'] for k in task.get('stack_acceptance',[])))
for case in st:
 check(case['id']+':reverse tasks',all(t in tm and case['id'] in tm[t].get('stack_acceptance',[]) for t in case['tasks']))
 check(case['id']+':behavior complete',all(case.get(k) for k in ['given','when','then','negative','evidence_required']))
prd=(R/'prd.md').read_text(encoding='utf8');plan=(R/'plan.md').read_text(encoding='utf8')
for i in list(rm)+list(tm)+list(cm):check('PRD contains '+i,i in prd)
for i in tm:check('plan contains '+i,i in plan)
check('vision prompt source control','prompts' in (R/'AGENTS.md').read_text(encoding='utf8'))

# Additional cross-file and helper-schema checks, still specification-only.
check('traceability exact FR rows',len(rows)==len(reqs) and {v['requirement'] for v in rows}==set(rm))
for row in rows:
 ref=rm[row['requirement']]
 check('traceability exact:'+row['requirement'],set(row['tasks'].split(';'))==set(ref['tasks']) and set(row['tests'].split(';'))==set(ref['tests']))
vision=load('contracts/vision-output.schema.json');Draft202012Validator.check_schema(vision)
vv=Draft202012Validator(vision)
vobj={'lines':[{'index':1,'text':'f(x)=x','uncertain':True}]}
check('vision minimal positive',not list(vv.iter_errors(vobj)))
for field in ['confirmed','id','revision','media_id']:
 bad=copy.deepcopy(vobj);bad[field]=True
 check('vision forbids server field:'+field,bool(list(vv.iter_errors(bad))))
bad=copy.deepcopy(vobj);bad['lines'][0]['explicitly_confirmed']=True
check('vision forbids model confirmation',bool(list(vv.iter_errors(bad))))
for item in load('evidence/manifest.json')['files']:
 source=R/item['path']
 check('evidence hash:'+item['path'],source.is_file() and source.stat().st_size==item['bytes'] and hashlib.sha256(source.read_bytes()).hexdigest()==item['sha256'])

failed=[r for r in results if not r['passed']]
report=dict(baseline='qisi-3.1',generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),scope='specification_only',passed=len(results)-len(failed),failed=len(failed),application_tests='not_run',mysql_ddl_tests='not_run',langgraph_runtime_tests='not_run',real_model_tests='not_run',student_learning_evaluation='not_evaluated',limitations=['Semantic oracles cover the supplied cases, not all production behavior.','MySQL DDL is not executed by this validator; validate_mysql.py and application integration tests must run against real MySQL 8.4.','No official question bank, provider calls, deployment or learning experiment was executed.'],checks=results)
(R/'spec-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False,indent=2))
for r in failed:print('FAIL',r['check'],r['detail'])
sys.exit(bool(failed))
