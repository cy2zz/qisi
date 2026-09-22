"""Local disposable MySQL conformance runner. Never connects to the developer's configured DB.
Creates its own no-defaults loopback server, random credentials and empty qisi_spec_* schema.
No recursive delete; retains the private temporary data directory for inspection after shutdown.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

server = Path(__file__).resolve().parents[2]
test_file = os.environ.get('QISI_MYSQL_SPEC_FILE', 'test/tutor/learning-persistence.mysql.spec.ts')
if test_file not in {'test/tutor/learning-persistence.mysql.spec.ts', 'test/model/chat-latency.live.spec.ts'}:
    raise SystemExit('refusing an unregistered isolated MySQL test file')
if test_file == 'test/model/chat-latency.live.spec.ts' and os.environ.get('QISI_LIVE_MODEL_TEST') != '1':
    raise SystemExit('live model tests require explicit QISI_LIVE_MODEL_TEST=1')
mysqld = shutil.which('mysqld')
node = shutil.which('node')
if not mysqld or not node:
    raise SystemExit('tool_unavailable: local mysqld and node are required')
workspace = Path(tempfile.mkdtemp(prefix='qisi_spec_b_turn_')).resolve()
data = workspace / 'data'
data.mkdir()
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
name = 'qisi_spec_b_turn_' + secrets.token_hex(6)
password = secrets.token_hex(32)
env = {**os.environ, 'QISI_MYSQL_SPEC_TEST':'1', 'QISI_MYSQL_SPEC_HOST':'127.0.0.1',
       'QISI_MYSQL_SPEC_PORT':str(port), 'QISI_MYSQL_SPEC_NAME':name,
       'QISI_MYSQL_SPEC_USER':'qisi_spec', 'QISI_MYSQL_SPEC_PASSWORD':password}
hidden = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
init_file = workspace / 'initialize.sql'
init_file.write_text("ALTER USER 'root'@'localhost' IDENTIFIED BY '"+password+"';\n"
    +"CREATE USER 'qisi_spec'@'127.0.0.1' IDENTIFIED BY '"+password+"';\n"
    +"GRANT ALL PRIVILEGES ON `"+name+"`.* TO 'qisi_spec'@'127.0.0.1';\n", encoding='utf-8')
base = str(Path(mysqld).parent.parent)
log = (workspace / 'server.log').open('wb')
process = None
exit_code = 1
shutdown = 'not_started'
common = [mysqld, '--no-defaults', '--basedir='+base, '--datadir='+str(data)]
connect_js = """import mysql from 'mysql2/promise';
const e=process.env;
const c=await mysql.createConnection({host:e.QISI_MYSQL_SPEC_HOST,port:Number(e.QISI_MYSQL_SPEC_PORT),user:e.QISI_MYSQL_SPEC_USER,password:e.QISI_MYSQL_SPEC_PASSWORD});
"""
def node_code(code, extra=None, quiet=False):
    return subprocess.run([node,'--input-type=module','-e',connect_js+code],cwd=server,
        env={**env,**(extra or {})},creationflags=hidden,
        stdout=subprocess.DEVNULL if quiet else subprocess.PIPE,stderr=subprocess.DEVNULL if quiet else subprocess.PIPE)
try:
    initialized = subprocess.run(common+['--initialize-insecure','--console'],stdout=log,stderr=log,creationflags=hidden,timeout=90)
    if initialized.returncode: raise RuntimeError('isolated MySQL initialization failed')
    process = subprocess.Popen(common+['--port='+str(port),'--bind-address=127.0.0.1',
        '--mysqlx=OFF','--skip-log-bin','--init-file='+str(init_file),'--console'],
        stdout=log,stderr=log,creationflags=hidden)
    for _ in range(40):
        if process.poll() is not None: raise RuntimeError('isolated MySQL stopped before readiness')
        if node_code('await c.ping(); await c.end();',quiet=True).returncode == 0: break
        time.sleep(0.5)
    else: raise RuntimeError('isolated MySQL readiness timed out')
    # This specific private file belongs to this runner; never recursively remove the workspace.
    init_file.unlink()
    created=node_code("if(!/^qisi_spec_[a-z0-9_]+$/.test(e.QISI_MYSQL_SPEC_NAME)) throw Error('unsafe schema'); await c.query('CREATE DATABASE `'+e.QISI_MYSQL_SPEC_NAME+'` CHARACTER SET utf8mb4'); await c.end();")
    if created.returncode: raise RuntimeError('new isolated schema creation failed')
    print(json.dumps({'isolated_mysql':True,'host':'127.0.0.1','port':port,'schema':name,'temporary_directory':str(workspace),'existing_business_database_used':False}),flush=True)
    version=node_code("const [rows]=await c.query('SELECT VERSION() AS version'); console.log(JSON.stringify({actual_mysql_version:rows[0].version})); await c.end();")
    print(version.stdout.decode('utf-8',errors='replace'),flush=True)
    if version.returncode: raise RuntimeError('isolated MySQL version query failed')
    result=subprocess.run([node,'--input-type=module','-e',"process.argv=['node','vitest','run',process.env.QISI_MYSQL_SPEC_FILE || 'test/tutor/learning-persistence.mysql.spec.ts','--reporter=verbose']; await import(new URL('./vitest.mjs',import.meta.resolve('vitest/package.json')).href);"],cwd=server,env=env,creationflags=hidden,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    exit_code=result.returncode
    (workspace / 'vitest.log').write_bytes(result.stdout)
    print(result.stdout.decode('utf-8', errors='replace'), flush=True)
finally:
    if process is not None and process.poll() is None:
        stopped=node_code("await c.query('SHUTDOWN'); await c.end();",{'QISI_MYSQL_SPEC_USER':'root'},quiet=True)
        try:
            process.wait(timeout=15)
            shutdown='sql_shutdown'
        except subprocess.TimeoutExpired:
            process.terminate() # only the exact child process created above, never an existing service
            process.wait(timeout=15)
            shutdown='owned_child_terminated'
    if init_file.exists(): init_file.unlink()
    log.close()
    print(json.dumps({'test_exit_code':exit_code,'shutdown':shutdown,'temporary_data_retained':str(data),'credentials_logged':False}),flush=True)
sys.exit(exit_code)
