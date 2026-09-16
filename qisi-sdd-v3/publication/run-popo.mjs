// Invoke the installed CLI unchanged, retaining the event loop until runCli settles.
// No checks/auth/network restrictions are disabled and no global package is edited.
import { pathToFileURL } from 'node:url';
const entry='D:/Node/node_global/node_modules/@popo/cli/bin/popo.js';
const args=[process.execPath,entry,...process.argv.slice(2)];
process.argv=args;
delete process.env.NODE_OPTIONS;
delete process.env.NPM_CONFIG_PREFIX;
delete process.env.NODE_PATH;
const keepAlive=setInterval(()=>{},1000);
try {
  const {runCli}=await import(pathToFileURL('D:/Node/node_global/node_modules/@popo/cli/dist/cli.js').href);
  await runCli(args);
} catch(error) {console.error(error.message); process.exitCode=1;}
finally {clearInterval(keepAlive);}