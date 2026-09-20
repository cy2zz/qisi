import { randomBytes, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { config as loadEnvironmentFile } from 'dotenv';
import type { AppEnvironment } from '../src/config/env.js';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import { assessmentTaskVerificationSchema } from '../src/features/assessment/assessment.schema.js';
import { TASK_VERIFICATION_PROMPT } from '../src/features/assessment/assessment.service.js';
import { OpenAiCompatibleModelPort } from '../src/model/openai-compatible-model.port.js';

interface AttemptResponse {
  attempt: {
    id: string;
    phase: string;
    promptMarkdown: string;
    relation: 'near_duplicate' | 'near_transfer';
    result: {
      execution: string;
      independentTaskPass: boolean;
      planning: string;
    } | null;
    taskId: string;
    version: number;
    [key: string]: unknown;
  };
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  const database = createDatabase(environment);
  const model = new OpenAiCompatibleModelPort({
    get: (key: keyof AppEnvironment) => environment[key],
  } as ConfigService<AppEnvironment, true>);
  const username = `live-as-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
  const apiBase = 'http://127.0.0.1:3000/api';
  let cookie = '';

  async function request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: environment.WEB_ORIGIN,
        ...init.headers,
      },
    });
    const setCookie = response.headers.getSetCookie()[0];
    if (setCookie) cookie = setCookie.split(';', 1)[0] ?? '';
    const body = await response.json() as { message?: unknown };
    if (!response.ok) {
      const message = typeof body.message === 'string' ? `: ${body.message}` : '';
      throw new Error(`${path} failed with ${response.status}${message}`);
    }
    return body as T;
  }

  async function requestStream(path: string, body: unknown) {
    const response = await fetch(`${apiBase}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: environment.WEB_ORIGIN,
      },
      method: 'POST',
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${text}`);
    return text;
  }

  try {
    const originalAnalysis = {
      firstQuestion: '你准备怎么配方？',
      keyConditions: ['二次项系数为 1'],
      knowledgePoints: ['配方法', '二次函数最值'],
      overview: '二次函数最值题',
      target: '求最小值',
    };
    const duplicateReviewResponse = await model.generate({
      input: JSON.stringify({
        candidate: {
          equivalenceGroup: 'renamed-monic-quadratic-minimum',
          promptMarkdown: '求函数 $g(x)=x^2-6x+5$ 的最小值，并说明关键一步。',
          referenceAnswerMarkdown: '$g(x)=(x-3)^2-4$，最小值为 $-4$。',
          relation: 'near_transfer',
          rubric: ['正确配方', '给出最小值'],
        },
        originalAnalysis,
        originalProblemMarkdown: '求函数 $f(x)=x^2-4x$ 的最小值，并说明关键一步。',
      }),
      maxOutputTokens: 800,
      role: 'guard',
      signal: new AbortController().signal,
      system: TASK_VERIFICATION_PROMPT,
    });
    const duplicateReview = assessmentTaskVerificationSchema.parse(
      duplicateReviewResponse.parsed,
    );
    if (duplicateReview.verdict !== 'reject') {
      throw new Error('live guard accepted a task that only changed variables and numbers');
    }

    await request('/auth/login', {
      body: JSON.stringify({ username }),
      method: 'POST',
    });
    const originalProblemMarkdown = '求函数 $f(x)=x^2-4x$ 的最小值，并说明关键一步。';
    const analyzed = await request<{ session: { id: string; version: number } }>('/problems/analyze', {
      body: JSON.stringify({
        content: originalProblemMarkdown,
        problemMd: originalProblemMarkdown,
        title: '独立检验真实模型验证',
        topic: '二次函数最值',
      }),
      method: 'POST',
    });
    const originalCheckStream = await requestStream('/problems/chat', {
      assistanceMode: 'finish_problem',
      expectedVersion: analyzed.session.version,
      history: [],
      message: '配方得到 $f(x)=(x-2)^2-4$；因为平方项非负，所以最小值是 $-4$。',
      problemMd: originalProblemMarkdown,
      requestId: randomUUID(),
      sessionId: analyzed.session.id,
    });
    const donePayload = [...originalCheckStream.matchAll(/event: done\ndata: ([^\n]+)/g)].at(-1)?.[1];
    const originalCheck = donePayload
      ? JSON.parse(donePayload) as { currentVerdict?: string }
      : null;
    if (originalCheck?.currentVerdict !== 'correct') {
      throw new Error('live original answer was not checked correct before independent assessment');
    }
    const started = await request<AttemptResponse>(
      `/assessment/sessions/${analyzed.session.id}/start`,
      { body: '{}', method: 'POST' },
    );
    if ('referenceAnswerMarkdown' in started.attempt || 'rubric' in started.attempt) {
      throw new Error('private assessment material leaked to the client');
    }
    const initialTask = await database
      .selectFrom('assessment_tasks')
      .select([
        'equivalence_group',
        'prompt_markdown',
        'reference_answer_markdown',
        'relation',
        'rubric_json',
        'verification_json',
      ])
      .where('id', '=', started.attempt.taskId)
      .where('user_id', '=', (builder) => builder
        .selectFrom('users')
        .select('id')
        .where('username_normalized', '=', username))
      .executeTakeFirstOrThrow();
    const planned = await request<AttemptResponse>(
      `/assessment/attempts/${started.attempt.id}/plan`,
      {
        body: JSON.stringify({
          expectedVersion: started.attempt.version,
          noPlan: false,
          planMarkdown: '先配方写成平方项加常数，再利用平方项非负判断最小值。',
        }),
        method: 'POST',
      },
    );
    const finished = await request<AttemptResponse>(
      `/assessment/attempts/${started.attempt.id}/finish`,
      {
        body: JSON.stringify({
          answerMarkdown: '按题目给出的函数完成配方，并由平方项非负得到顶点处的最小值。',
          expectedVersion: planned.attempt.version,
        }),
        method: 'POST',
      },
    );
    if (finished.attempt.phase !== 'summary' || !finished.attempt.result) {
      throw new Error('live assessment did not reach a safe summary');
    }
    const reassessed = await request<AttemptResponse>(
      `/assessment/sessions/${analyzed.session.id}/reassess`,
      { body: '{}', method: 'POST' },
    );
    const reassessmentTask = await database
      .selectFrom('assessment_tasks')
      .select([
        'equivalence_group',
        'prompt_markdown',
        'reference_answer_markdown',
        'relation',
        'rubric_json',
        'verification_json',
      ])
      .where('id', '=', reassessed.attempt.taskId)
      .executeTakeFirstOrThrow();
    if (
      reassessed.attempt.id === started.attempt.id
      || reassessed.attempt.promptMarkdown === started.attempt.promptMarkdown
      || reassessed.attempt.relation !== 'near_transfer'
      || reassessmentTask.equivalence_group === initialTask.equivalence_group
    ) {
      throw new Error('live reassessment reused an equivalent or non-transfer task');
    }
    const auditRows = await database
      .selectFrom('runs as run')
      .innerJoin('node_runs as node', 'node.run_id', 'run.id')
      .select(['node.node_key', 'node.status', 'node.usage_json', 'run.workflow'])
      .where('run.user_id', '=', (builder) => builder
        .selectFrom('users')
        .select('id')
        .where('username_normalized', '=', username))
      .where('run.workflow', 'in', ['grade', 'prepare'])
      .execute();
    const auditedNodeKeys = new Set(auditRows.map((row) => row.node_key));
    if (
      !auditedNodeKeys.has('task_generation_1')
      || !auditedNodeKeys.has('task_guard_1')
      || !auditedNodeKeys.has('grade')
      || !auditedNodeKeys.has('grade_guard')
      || !auditRows.some((row) => row.node_key.startsWith('reassessment_generation_'))
      || !auditRows.some((row) => row.node_key.startsWith('reassessment_guard_'))
      || auditRows.some((row) => row.status !== 'completed' || row.usage_json === null)
    ) {
      throw new Error('live assessment model nodes were not completely audited');
    }
    console.info(
      `live assessment passed: phase=${finished.attempt.phase}, planning=${finished.attempt.result.planning}, execution=${finished.attempt.result.execution}, independentPass=${finished.attempt.result.independentTaskPass}, privateMaterialLeaked=false, liveNearDuplicateRejected=true, reassessmentDistinct=true, nodeAudit=true`,
    );
    console.info(JSON.stringify({
      initialTask: {
        equivalenceGroup: initialTask.equivalence_group,
        promptMarkdown: initialTask.prompt_markdown,
        referenceAnswerMarkdown: initialTask.reference_answer_markdown,
        relation: initialTask.relation,
        rubric: initialTask.rubric_json,
        verification: initialTask.verification_json,
      },
      liveNearDuplicateReview: duplicateReview,
      originalProblemMarkdown: '求函数 $f(x)=x^2-4x$ 的最小值，并说明关键一步。',
      reassessmentTask: {
        equivalenceGroup: reassessmentTask.equivalence_group,
        promptMarkdown: reassessmentTask.prompt_markdown,
        referenceAnswerMarkdown: reassessmentTask.reference_answer_markdown,
        relation: reassessmentTask.relation,
        rubric: reassessmentTask.rubric_json,
        verification: reassessmentTask.verification_json,
      },
    }, null, 2));
  } finally {
    await database.deleteFrom('users').where('username_normalized', '=', username).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Live assessment verification failed');
  process.exitCode = 1;
});
