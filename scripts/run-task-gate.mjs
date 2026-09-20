import { spawnSync } from 'node:child_process';

const [gate, taskId] = process.argv.slice(2);

// 已登记的任务门禁。新增任务时在此登记。
// 未登记的任务显式报错而非静默通过——空跑会被误读成验收通过（AGENTS.md §8）。
const SUPPORTED_TASKS = new Set(['A01', 'B03']);

if (!SUPPORTED_TASKS.has(taskId)) {
  console.error(
    `Unsupported task gate: ${taskId || '<missing>'}. Add it to SUPPORTED_TASKS in scripts/run-task-gate.mjs first.`,
  );
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
