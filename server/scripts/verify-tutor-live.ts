import 'reflect-metadata';
import { config as loadEnvironmentFile } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';

interface SseEvent {
  data: Record<string, unknown>;
  event: string;
}

function readSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '';
      const rawData = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}';
      return { data: JSON.parse(rawData) as Record<string, unknown>, event };
    });
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  if (!environment.AI_API_KEY) throw new Error('AI_API_KEY is required for the live tutor verifier');

  const database = createDatabase(environment);
  const apiBaseUrl = `http://127.0.0.1:${environment.PORT}/api`;
  const username = `tutor_live_${Date.now()}`;
  let userId: string | undefined;

  try {
    const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
      body: JSON.stringify({ username }),
      headers: { 'Content-Type': 'application/json', Origin: environment.WEB_ORIGIN },
      method: 'POST',
    });
    if (!loginResponse.ok) throw new Error(`live tutor login failed: HTTP ${loginResponse.status}`);
    const login = await loginResponse.json() as { user: { id: string } };
    userId = String(login.user.id);
    const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('live tutor login did not return an auth cookie');

    const problemMd = '化简 $\\frac{\\sqrt{2}}{\\sqrt{3}}$。';
    const analysisResponse = await fetch(`${apiBaseUrl}/problems/analyze`, {
      body: JSON.stringify({ content: problemMd, problemMd, title: '四角色教学验证' }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: environment.WEB_ORIGIN,
      },
      method: 'POST',
    });
    if (!analysisResponse.ok) {
      throw new Error(`live preparation failed: HTTP ${analysisResponse.status}`);
    }
    const prepared = await analysisResponse.json() as {
      analysis: unknown;
      session: { id: string; version: number };
    };

    const requestId = randomUUID();
    const turnResponse = await fetch(`${apiBaseUrl}/problems/chat`, {
      body: JSON.stringify({
        assistanceMode: 'attempt',
        expectedVersion: prepared.session.version,
        history: [],
        message: '我准备给分子分母同时乘以 $\\sqrt{3}$，再约分。',
        problemMd,
        requestId,
        sessionId: prepared.session.id,
      }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: environment.WEB_ORIGIN,
      },
      method: 'POST',
    });
    if (!turnResponse.ok) throw new Error(`live tutor turn failed: HTTP ${turnResponse.status}`);

    const events = readSse(await turnResponse.text());
    const errorEvent = events.find((event) => event.event === 'error');
    if (errorEvent) throw new Error(`live tutor returned an error event: ${String(errorEvent.data.message)}`);
    if (!events.some((event) => event.event === 'done')) {
      throw new Error('live tutor turn did not reach the done event');
    }
    const reply = events
      .filter((event) => event.event === 'chunk')
      .map((event) => String(event.data.text ?? ''))
      .join('');
    if (!reply.trim()) throw new Error('live tutor returned an empty checked reply');

    const nodes = await database
      .selectFrom('node_runs')
      .innerJoin('runs', 'runs.id', 'node_runs.run_id')
      .select([
        'node_runs.model_id',
        'node_runs.node_key',
        'node_runs.prompt_version',
        'node_runs.status',
        'node_runs.usage_json',
      ])
      .where('runs.session_id', '=', prepared.session.id)
      .orderBy('node_runs.id', 'asc')
      .execute();
    const expectedNodes = ['diagnosis', 'strategy', 'renderer', 'guard'];
    if (JSON.stringify(nodes.map((node) => node.node_key)) !== JSON.stringify(expectedNodes)) {
      throw new Error(`live tutor node order mismatch: ${nodes.map((node) => node.node_key).join(',')}`);
    }
    if (nodes.some((node) =>
      node.status !== 'completed'
      || !node.model_id
      || node.prompt_version !== 'prompt-v3.0'
      || !node.usage_json)) {
      throw new Error('live tutor node audit is missing model, prompt, usage, or completed status');
    }
    const usages = nodes.map((node) => node.usage_json as {
      input: number;
      kind: string;
      output: number;
      provider: string;
    });
    const inputTokens = usages.reduce((sum, usage) => sum + usage.input, 0);
    const outputTokens = usages.reduce((sum, usage) => sum + usage.output, 0);

    const statuses = events
      .filter((event) => event.event === 'status')
      .map((event) => String(event.data.message ?? ''));
    console.info(
      `live tutor passed: nodes=${nodes.map((node) => node.node_key).join('>')}, model=${nodes[0]?.model_id}, prompt=${nodes[0]?.prompt_version}, usageKinds=${usages.map((usage) => usage.kind).join(',')}, inputTokens=${inputTokens}, outputTokens=${outputTokens}, statuses=${statuses.length}, replyChars=${reply.length}`,
    );
  } finally {
    if (userId) await database.deleteFrom('users').where('id', '=', userId).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Live tutor verification failed');
  process.exitCode = 1;
});
