from pathlib import Path
import hashlib,json,zipfile,datetime
R=Path(__file__).resolve().parents[1]
root_names=['README.md','AGENTS.md','design-v6.md','plan.md','prd.md','reuse.md','requirements.json','tasks.json','traceability.csv','scope-changes.json','runtime.json','reuse-lock.json','env.example','requirements-dev.txt','spec-validation.json','stack.json']
files=[R/x for x in root_names]
for d in ['contracts','acceptance','fixtures','prompts','changes','handoffs','evidence','adr']:
 files.extend(p for p in (R/d).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
files.extend(R/x for x in ['scripts/validate_spec.py','scripts/semantic_rules.py','scripts/package.py','scripts/validate_stack.py','scripts/validate_mysql.py','scripts/test_validate_mysql.py','publication/publication-status.json','publication/README.md','publication/local-revision-status.json'])
assert all(p.is_file() for p in files)
report=json.loads((R/'spec-validation.json').read_text(encoding='utf8'))
assert report['failed']==0 and report['scope']=='specification_only'
files=sorted(set(files))
manifest={'baseline':'qisi-3.1','kind':'specification_not_application','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':[{'path':p.relative_to(R).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
(R/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
files.append(R/'manifest.json')
z=R.parent/'qisi-sdd-v3.zip'
with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as out:
 for p in files:out.write(p,'qisi-sdd-v3/'+p.relative_to(R).as_posix())
with zipfile.ZipFile(z) as inp:
 assert inp.testzip() is None
 assert not any(n.endswith('.env') or '__pycache__' in n or '..' in Path(n).parts for n in inp.namelist())
 for item in manifest['files']:
  data=inp.read('qisi-sdd-v3/'+item['path'])
  assert hashlib.sha256(data).hexdigest()==item['sha256'] and len(data)==item['bytes']
summary={'file':z.name,'bytes':z.stat().st_size,'sha256':hashlib.sha256(z.read_bytes()).hexdigest(),'files':len(files),'archive_verified':True,'spec_checks_passed':report['passed'],'spec_checks_failed':report['failed'],'baseline':'qisi-3.1','mysql_ddl_tests':'not_run','langgraph_runtime_tests':'not_run','application_tests':'not_run','real_model_tests':'not_run','student_learning_evaluation':'not_evaluated','online_publication_status':json.loads((R/'publication/local-revision-status.json').read_text(encoding='utf8'))['status']}
(R/'publication/package-verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(summary,ensure_ascii=False,indent=2))