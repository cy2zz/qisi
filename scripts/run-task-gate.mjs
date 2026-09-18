import { spawnSync } from 'node:child_process';

const [gate, taskId] = process.argv.slice(2);

if (taskId !== 'A01') {
  console.error(`Unsupported task gate: ${taskId || '<missing>'}. Add an explicit mapping first.`);
  process.exitCode = 1;
} else {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const gates = {
    unit: [
      ['--prefix', 'server', 'test'],
      ['--prefix', 'web', 'test'],
    ],
    e2e: [['run', 'test:e2e', '--', '--grep', `@${taskId}`]],
    stack: [
      ['run', 'typecheck'],
      ['run', 'lint'],
      ['run', 'test:task', '--', taskId],
      ['run', 'test:db'],
      ['run', 'test:e2e:task', '--', taskId],
      ['run', 'build'],
    ],
  };

  const commands = gates[gate];
  if (!commands) {
    console.error(`Unsupported gate: ${gate || '<missing>'}`);
    process.exitCode = 1;
  } else {
    for (const args of commands) {
      const result = spawnSync(npm, args, { stdio: 'inherit' });
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        break;
      }
    }
  }
}
