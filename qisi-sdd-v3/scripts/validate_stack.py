"""Static stack contract checks. Does NOT execute MySQL, Node or LangGraph."""
from pathlib import Path
import json,re,sys
R=Path(__file__).resolve().parents[1]
def inspect():
 out=[]
 def check(name,ok):out.append({"check":name,"passed":bool(ok)})
 def load(name):
  p=R/name
  return json.loads(p.read_text(encoding="utf8")) if p.exists() else {}
 s=load("stack.json");r=load("runtime.json")
 for name,value in {"baseline":"qisi-3.1","node":"24 LTS","node_patch":"24.21.0","react":"19","frontend_framework":"React","frontend_build_tool":"Vite 8","backend_framework":"NestJS 12","language":"TypeScript","database":"MySQL 8.4 LTS","database_driver":"mysql2","data_access":"Kysely + explicit SQL migrations","orchestration":"NestJS bounded workflows; LangGraph.js StateGraph when needed","model_sdk":"AI SDK Core"}.items():
  check("stack:"+name,s.get(name)==value)
 check("patch versions honestly pending",s.get("dependency_status")=="selected_not_installed")
 check("runtime NestJS worker",r.get("runner")=="nestjs_worker_with_optional_langgraphjs")
 check("runtime mysql only",r.get("database",{}).get("engine")=="mysql" and r.get("database",{}).get("version_line")=="8.4")
 check("domain owns final transaction",r.get("business_commit_owner")=="StorePort.commitChecked")
 check("no model sdk automatic retries",r.get("model_sdk_max_retries")==0)
 check("API and worker separated",r.get("api_worker_separation") is True)
 check("single recovery worker",r.get("single_recovery_worker") is True)
 deps={x["package"] for x in load("reuse-lock.json").get("items",[])}
 for p in ["@nestjs/core","@nestjs/common","vite","@vitejs/plugin-react","react","mysql2","kysely","@langchain/langgraph","ai","tailwindcss","zod","@playwright/test"]:check("dependency:"+p,p in deps)
 check("removed full-stack framework absent","next" not in deps)
 check("no sqlite runtime dependency",not any("sqlite" in p.lower() for p in deps))
 sql=(R/"contracts/database.sql").read_text(encoding="utf8")
 tables=re.findall(r"CREATE TABLE ([a-z_]+)",sql)
 check("mysql 19 unique tables",len(tables)==19 and len(set(tables))==19)
 check("all tables InnoDB",sql.count("ENGINE=InnoDB")==19)
 check("native JSON columns",bool(re.search(r"\w+_json JSON",sql)))
 check("mysql explicit foreign keys",sql.count("FOREIGN KEY")>=20)
 check("probe cap enforced contract","CHECK(shown_count BETWEEN 0 AND 2)" in sql)
 check("no sqlite SQL",not re.search(r"PRAGMA|AUTOINCREMENT|ON CONFLICT|INSERT OR REPLACE|BEGIN IMMEDIATE",sql,re.I))
 for t in ["workflow_checkpoints","workflow_writes","schema_migrations"]:check("table:"+t,t in tables)
 for p in ["adr/ADR-001-stack.md","contracts/workflow-persistence.md","contracts/mysql.md","acceptance/stack-cases.json","scripts/validate_mysql.py","publication/local-revision-status.json"]:check("file:"+p,(R/p).is_file())
 cases=load("acceptance/stack-cases.json")
 if isinstance(cases,list):
  check("stack cases unique",len(cases)>=10 and len(cases)==len({c['id'] for c in cases}))
  check("stack runtime acceptance not fabricated",all(c['status']=='specified' and c['result']=='not_run' for c in cases))
 else:check("stack acceptance exists",False)
 for p in ["README.md","AGENTS.md","prd.md","plan.md","design-v6.md","contracts/README.md","prompts/developer-a.md","prompts/developer-b.md","prompts/developer-single.md"]:
  text=(R/p).read_text(encoding="utf8")
  check("baseline:"+p,"qisi-3.1" in text)
  check("no active old app directory:"+p,"qisi-web" not in text)
  check("stack reference:"+p,"ADR-001" in text or "stack.json" in text)
 tasks=load("tasks.json")
 for name in ["plan.md","prd.md"]:
  text=(R/name).read_text(encoding="utf8")
  headings=re.findall(r"^### ([AB]\d{2})[｜]",text,re.M)
  check("unique task cards:"+name,len(headings)==20 and len(set(headings))==20)
  for task in tasks:
   check("task steps synchronized:"+name+":"+task['id'],all(step in text for step in task['steps']))
 for name in ["plan.md","prd.md","reuse.md","prompts/developer-b.md"]:
  text=(R/name).read_text(encoding="utf8")
  for stale in ["SQLite迁移","默认原生TS编排ADR","LangGraph.js为候选非必装","候选暂不作为基线依赖"]:
   check("no stale directive:"+name+":"+stale,stale not in text)
 return out
if __name__=="__main__":
 checks=inspect();failed=[x for x in checks if not x['passed']]
 print(json.dumps({"scope":"static_specification_only","passed":len(checks)-len(failed),"failed":len(failed),"checks":checks},ensure_ascii=False,indent=2))
 sys.exit(bool(failed))
