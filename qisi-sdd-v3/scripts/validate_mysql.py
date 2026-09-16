"""Opt-in MySQL 8.4 DDL/constraint smoke test, not application acceptance.
Uses a pre-existing EMPTY qisi_spec_* database. Never creates/drops databases.
Credentials are read by mysql CLI from external config/MYSQL_PWD, never printed.
"""
from pathlib import Path
import json,os,re,shutil,subprocess,sys
R=Path(__file__).resolve().parents[1]
def preflight(env):
    db=env.get('MYSQL_TEST_DATABASE','')
    if env.get('QISI_MYSQL_SPEC_TEST')!='1':
        return 'not_run: set QISI_MYSQL_SPEC_TEST=1 and an isolated empty MySQL 8.4 test database'
    if not re.fullmatch(r'qisi_spec_[a-zA-Z0-9_]{1,48}',db):
        return 'not_run: MYSQL_TEST_DATABASE must be a dedicated qisi_spec_* database'
    return None

def main():
    reason=preflight(os.environ)
    if reason:
        print(json.dumps({'scope':'mysql_ddl_only','status':'not_run','reason':reason}));return 2
    cli=os.environ.get('MYSQL_TEST_CLI') or shutil.which('mysql')
    if not cli:
        print(json.dumps({'scope':'mysql_ddl_only','status':'not_run','reason':'mysql CLI unavailable'}));return 2
    args=[cli]
    if os.environ.get('MYSQL_TEST_LOGIN_PATH'):args+=['--login-path='+os.environ['MYSQL_TEST_LOGIN_PATH']]
    args+=['--batch','--skip-column-names','--raw','--default-character-set=utf8mb4',
           '--database='+os.environ['MYSQL_TEST_DATABASE']]
    for env,option in [('MYSQL_TEST_HOST','--host'),('MYSQL_TEST_PORT','--port'),('MYSQL_TEST_USER','--user')]:
        if os.environ.get(env):args += [option+'='+os.environ[env]]
    results=[];eligible=False;error=None
    sql=(R/'contracts/database.sql').read_text(encoding='utf8')
    tables=re.findall(r'CREATE TABLE ([a-z_]+)',sql)
    def run(query):
        return subprocess.run(args,input=query,encoding='utf8',capture_output=True,timeout=30)
    def execute(query):
        p=run(query)
        if p.returncode:
            code=re.search(r'ERROR (\d+)',p.stderr)
            raise RuntimeError('mysql command failed; error_code='+(code.group(1) if code else 'unknown'))
        return p.stdout.strip()
    def check(name,ok):
        results.append({'check':name,'passed':bool(ok)})
        if not ok:raise AssertionError(name)
    def rejects(name,query,code):
        p=run(query);check(name,p.returncode!=0 and re.search(r'ERROR '+str(code)+r'\b',p.stderr) is not None)
    try:
        version=execute('SELECT VERSION();');check('server is MySQL 8.4',bool(re.match(r'^8\.4\.',version)))
        check('dedicated database is empty',execute('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();')=='0')
        eligible=True
        execute(sql)
        check('19 tables created',execute('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();')=='19')
        execute("INSERT INTO owners VALUES('o','h','2099-01-01 00:00:00',0);")
        execute("INSERT INTO sessions VALUES('s','o',1,'study','{}','{}',NULL,'2099-01-01 00:00:00');")
        execute("INSERT INTO probe_counters VALUES('s','t','g',2);")
        rejects('probe cap',"UPDATE probe_counters SET shown_count=3;",3819)
        rejects('foreign owner',"INSERT INTO sessions VALUES('s2','missing',1,'study','{}','{}',NULL,'2099-01-01 00:00:00');",1452)
        rejects('JSON validation',"UPDATE sessions SET state_json='not-json' WHERE id='s';",3140)
        execute("INSERT INTO requests VALUES('o','r','s','hash','in_progress',NULL,NULL,'2099-01-01 00:00:00');")
        rejects('request uniqueness',"INSERT INTO requests VALUES('o','r','s','hash','in_progress',NULL,NULL,'2099-01-01 00:00:00');",1062)
        execute("INSERT INTO runs VALUES('run','s','o','r','turn','lease',1,2,'2099-01-01 00:00:00','running','{}');")
        execute("INSERT INTO workflow_checkpoints(run_id,checkpoint_ns,checkpoint_id,checkpoint_type,checkpoint_blob,metadata_json) VALUES('run','','cp','json',X'7B7D','{}');")
        execute("INSERT INTO workflow_writes VALUES('run','','cp','task',0,'channel','json',X'7B7D','');")
        check('checkpoint bytes',execute("SELECT HEX(checkpoint_blob) FROM workflow_checkpoints;")=='7B7D')
        execute("DELETE FROM owners WHERE id='o';")
        for name in ['sessions','probe_counters','requests','runs','workflow_checkpoints','workflow_writes']:
            check('cascade:'+name,execute('SELECT COUNT(*) FROM '+name+';')=='0')
    except (RuntimeError,AssertionError,subprocess.SubprocessError,OSError) as exc:
        error=str(exc)
    finally:
        if eligible:
            # Exclusive empty test schema was checked before any DDL. Drop only our known tables.
            try:
                for table in reversed(tables):execute('DROP TABLE IF EXISTS `'+table+'`;')
            except Exception:
                error=(error or '')+' cleanup_failed: inspect dedicated test database manually'
    print(json.dumps({'scope':'mysql_ddl_only','status':'failed' if error else 'passed','error':error,'checks':results,
        'application_tests':'not_run','langgraph_tests':'not_run','learning_evaluation':'not_evaluated'},ensure_ascii=False,indent=2))
    return 1 if error else 0
if __name__=='__main__':sys.exit(main())
