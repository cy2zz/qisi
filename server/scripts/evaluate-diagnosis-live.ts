import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { config as loadEnvironmentFile } from 'dotenv';
import {
  DiagnosisSchema,
  StrategySchema,
  type Diagnosis,
  type Strategy,
} from '../src/contracts/domain.schema.js';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';

interface SseEvent {
  data: Record<string, unknown>;
  event: string;
}

interface EvaluationCase {
  expectedKind: Diagnosis['hypotheses'][number]['kind'];
  id: string;
  message: string;
}

const problemMd = '已知函数 $f(x)=x^3-3x$，求单调区间与极值。';
const cases: EvaluationCase[] = [
  {
    expectedKind: 'concept',
    id: 'concept-rule-reversed',
    message: '我算得 $f\'(x)=3x^2-3$，并认为在 $f\'(x)>0$ 时函数递减，因为我一直记得导数为正表示函数在往下走。',
  },
  {
    expectedKind: 'execution',
    id: 'execution-copy-slip',
    message: '我知道 $f\'(x)>0$ 表示递增。刚才写成递减只是抄错，现在改正为递增。',
  },
  {
    expectedKind: 'strategy',
    id: 'strategy-sign-to-monotonicity',
    message: '我已经算出 $f\'(x)=3x^2-3$，也解出 $f\'(x)>0$ 在 $x<-1$ 或 $x>1$。但我不知道怎样由这些符号区间写出原函数的单调区间。',
  },
];
const selectedCases = process.env.DIAGNOSIS_CASE
  ? cases.filter((item) => item.id === process.env.DIAGNOSIS_CASE)
  : cases;
if (selectedCases.length === 0) {
  throw new Error(`Unknown DIAGNOSIS_CASE: ${process.env.DIAGNOSIS_CASE}`);
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

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  if (!environment.AI_API_KEY) throw new Error('AI_API_KEY is required for live diagnosis evaluation');

  const database = createDatabase(environment);
  const apiBaseUrl = `http://127.0.0.1:${environment.PORT}/api`;
  const username = `diagnosis_live_${Date.now()}`;
  let userId: string | undefined;
  const results: Array<{
    diagnosis: Diagnosis;
    id: string;
    model: string;
    reply: string;
    strategy: Strategy;
  }> = [];

  try {
    const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
      body: JSON.stringify({ username }),
      headers: { 'Content-Type': 'application/json', Origin: environment.WEB_ORIGIN },
      method: 'POST',
    });
    if (!loginResponse.ok) throw new Error(`diagnosis evaluation login failed: HTTP ${loginResponse.status}`);
    const login = await loginResponse.json() as { user: { id: string } };
    userId = String(login.user.id);
    const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('diagnosis evaluation login did not return an auth cookie');

    for (const evaluationCase of selectedCases) {
      const analysisResponse = await fetch(`${apiBaseUrl}/problems/analyze`, {
        body: JSON.stringify({
          content: problemMd,
          problemMd,
          title: `诊断对照 ${evaluationCase.id}`,
        }),
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: environment.WEB_ORIGIN,
        },
        method: 'POST',
      });
      if (!analysisResponse.ok) throw new Error(`${evaluationCase.id} analysis failed: HTTP ${analysisResponse.status}`);
      const prepared = await analysisResponse.json() as { session: { id: string; version: number } };

      const turnResponse = await fetch(`${apiBaseUrl}/problems/chat`, {
        body: JSON.stringify({
          assistanceMode: 'explain',
          expectedVersion: prepared.session.version,
          history: [],
          message: evaluationCase.message,
          problemMd,
          requestId: randomUUID(),
          sessionId: prepared.session.id,
        }),
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          Origin: environment.WEB_ORIGIN,
        },
        method: 'POST',
      });
      if (!turnResponse.ok) throw new Error(`${evaluationCase.id} turn failed: HTTP ${turnResponse.status}`);
      const events = readSse(await turnResponse.text());
      const errorEvent = events.find((event) => event.event === 'error');
      if (errorEvent) {
        const failedNodes = await database
          .selectFrom('node_runs')
          .innerJoin('runs', 'runs.id', 'node_runs.run_id')
          .select(['node_runs.node_key', 'node_runs.status', 'node_runs.output_json'])
          .where('runs.session_id', '=', prepared.session.id)
          .orderBy('node_runs.id', 'asc')
          .execute();
        const failedRequest = await database
          .selectFrom('requests')
          .select(['error_json'])
          .where('session_id', '=', prepared.session.id)
          .where('status', '=', 'failed')
          .executeTakeFirst();
        throw new Error(
          `${evaluationCase.id} returned error: ${String(errorEvent.data.message)}; request=${JSON.stringify(failedRequest)}; nodes=${JSON.stringify(failedNodes)}`,
        );
      }
      const reply = events
        .filter((event) => event.event === 'chunk')
        .map((event) => String(event.data.text ?? ''))
        .join('');

      const nodes = await database
        .selectFrom('node_runs')
        .innerJoin('runs', 'runs.id', 'node_runs.run_id')
        .select(['node_runs.model_id', 'node_runs.node_key', 'node_runs.output_json'])
        .where('runs.session_id', '=', prepared.session.id)
        .where('node_runs.node_key', 'in', ['diagnosis', 'strategy'])
        .execute();
      const diagnosisRow = nodes.find((node) => node.node_key === 'diagnosis');
      const strategyRow = nodes.find((node) => node.node_key === 'strategy');
      if (!diagnosisRow?.output_json || !strategyRow?.output_json) {
        throw new Error(`${evaluationCase.id} is missing persisted diagnosis/strategy output`);
      }
      const diagnosis = DiagnosisSchema.parse(parseJson(diagnosisRow.output_json));
      const strategy = StrategySchema.parse(parseJson(strategyRow.output_json));
      if (!diagnosis.hypotheses.some((hypothesis) => hypothesis.kind === evaluationCase.expectedKind)) {
        throw new Error(
          `${evaluationCase.id} expected ${evaluationCase.expectedKind}, received ${diagnosis.hypotheses.map((item) => item.kind).join(',')}`,
        );
      }
      results.push({
        diagnosis,
        id: evaluationCase.id,
        model: diagnosisRow.model_id,
        reply,
        strategy,
      });
      console.info(JSON.stringify({
        case: evaluationCase.id,
        hypothesisKinds: diagnosis.hypotheses.map((item) => item.kind),
        intervention: strategy.intervention,
        model: diagnosisRow.model_id,
        replyChars: reply.length,
        scaffoldLevel: strategy.scaffold_level,
      }));
    }

    if (results.length !== cases.length) {
      console.info(JSON.stringify({ selectedCases: results.map((result) => result.id), status: 'passed' }));
      return;
    }

    const concept = results.find((result) => result.id === 'concept-rule-reversed')!;
    const execution = results.find((result) => result.id === 'execution-copy-slip')!;
    const strategy = results.find((result) => result.id === 'strategy-sign-to-monotonicity')!;
    const conceptTeaching = JSON.stringify({
      action: concept.strategy.action,
      artifact: concept.strategy.expected_student_artifact,
      intervention: concept.strategy.intervention,
      reply: concept.reply,
    });
    const executionTeaching = JSON.stringify({
      action: execution.strategy.action,
      artifact: execution.strategy.expected_student_artifact,
      intervention: execution.strategy.intervention,
      reply: execution.reply,
    });
    if (conceptTeaching === executionTeaching) {
      throw new Error('concept and execution cases received indistinguishable teaching actions');
    }
    if (!/[单调|递增|递减|符号区间]/.test(strategy.strategy.expected_student_artifact + strategy.reply)) {
      throw new Error('strategy connection case did not focus on sign-to-monotonicity linkage');
    }
    if (/重新求导|求导公式/.test(strategy.strategy.expected_student_artifact + strategy.reply)) {
      throw new Error('strategy connection case unnecessarily reteaches differentiation');
    }

    console.info(JSON.stringify({
      cases: results.map((result) => ({
        action: result.strategy.action,
        hypothesisKinds: result.diagnosis.hypotheses.map((item) => item.kind),
        id: result.id,
        intervention: result.strategy.intervention,
        model: result.model,
        replyChars: result.reply.length,
        scaffoldLevel: result.strategy.scaffold_level,
      })),
      conceptExecutionTeachingDiffers: true,
      strategyAvoidedReteachingDerivative: true,
    }));
  } finally {
    if (userId) await database.deleteFrom('users').where('id', '=', userId).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Live diagnosis evaluation failed');
  process.exitCode = 1;
});
