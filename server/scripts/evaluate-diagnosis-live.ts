import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { config as loadEnvironmentFile } from 'dotenv';
import { DiagnosisAgent } from '../src/agents/diagnosis/index.js';
import { StrategyAgent } from '../src/agents/strategy/index.js';
import type {
  Decision,
  Diagnosis,
  DiagnosisInput,
  Route,
  Strategy,
  StrategyInput,
} from '../src/contracts/domain.schema.js';
import {
  environmentFilePaths,
  parseEnvironment,
  type AppEnvironment,
} from '../src/config/env.js';
import { OpenAiCompatibleModelPort } from '../src/model/openai-compatible-model.port.js';

interface EvaluationCase {
  expectedKind: Diagnosis['hypotheses'][number]['kind'];
  id: string;
  message: string;
}

interface EvaluationResult {
  diagnosis: Diagnosis;
  id: string;
  model: string;
  strategy: Strategy;
  usage: {
    diagnosisInput: number;
    diagnosisOutput: number;
    strategyInput: number;
    strategyOutput: number;
  };
}

const problemMd = '已知函数 $f(x)=x^3-3x$，求单调区间与极值。';
const privateReferenceMd = [
  "$f'(x)=3x^2-3=3(x-1)(x+1)$。",
  "当 $x<-1$ 或 $x>1$ 时 $f'(x)>0$，函数递增；当 $-1<x<1$ 时 $f'(x)<0$，函数递减。",
  '$x=-1$ 处为极大值 $2$，$x=1$ 处为极小值 $-2$。',
].join('\n');
const cases: EvaluationCase[] = [
  {
    expectedKind: 'concept',
    id: 'concept-rule-reversed',
    message: "我算得 $f'(x)=3x^2-3$，并认为在 $f'(x)>0$ 时函数递减，因为我一直记得导数为正表示函数在往下走。",
  },
  {
    expectedKind: 'execution',
    id: 'execution-copy-slip',
    message: "我知道 $f'(x)>0$ 表示递增。刚才写成递减只是抄错，现在改正为递增。",
  },
  {
    expectedKind: 'strategy',
    id: 'strategy-sign-to-monotonicity',
    message: "我已经算出 $f'(x)=3x^2-3$，也解出 $f'(x)>0$ 在 $x<-1$ 或 $x>1$。但我不知道怎样由这些符号区间写出原函数的单调区间。",
  },
];

function buildRoute(taskId: string): { decisions: Decision[]; routes: Route[] } {
  const decisions: Decision[] = [
    {
      acceptance_rule: '导数式与定义域内求导规则正确。',
      common_gaps: ['execution', 'concept'],
      entry_condition: '已读题并选择导数路线。',
      expected_artifact: "写出 $f'(x)=3x^2-3$。",
      goal: '正确求导',
      goal_key: `${taskId}:differentiate`,
      id: 'differentiate',
      parent_goal_key: null,
      part_id: 'part-1',
      prerequisite_ids: [],
      source: 'teacher',
    },
    {
      acceptance_rule: '临界点与正负区间完整且端点处理正确。',
      common_gaps: ['execution', 'condition'],
      entry_condition: '导数已正确写出。',
      expected_artifact: "解出 $f'(x)>0$ 与 $f'(x)<0$ 的区间。",
      goal: '判断导数符号',
      goal_key: `${taskId}:sign`,
      id: 'sign',
      parent_goal_key: `${taskId}:differentiate`,
      part_id: 'part-1',
      prerequisite_ids: ['differentiate'],
      source: 'teacher',
    },
    {
      acceptance_rule: '将导数正负与原函数增减一一对应，不颠倒。',
      common_gaps: ['concept', 'strategy', 'representation'],
      entry_condition: '导数符号区间已获得。',
      expected_artifact: '由导数符号写出原函数单调区间。',
      goal: '连接导数符号与单调性',
      goal_key: `${taskId}:monotonicity`,
      id: 'monotonicity',
      parent_goal_key: `${taskId}:sign`,
      part_id: 'part-1',
      prerequisite_ids: ['sign'],
      source: 'teacher',
    },
    {
      acceptance_rule: '结合增减变化判断极值类型，并代入原函数求值。',
      common_gaps: ['strategy', 'execution'],
      entry_condition: '单调区间已正确写出。',
      expected_artifact: '写出极值点、极值类型和极值。',
      goal: '由单调性得到极值',
      goal_key: `${taskId}:extrema`,
      id: 'extrema',
      parent_goal_key: `${taskId}:monotonicity`,
      part_id: 'part-1',
      prerequisite_ids: ['monotonicity'],
      source: 'teacher',
    },
  ];

  return {
    decisions,
    routes: [{
      decision_ids: decisions.map((decision) => decision.id),
      evidence_refs: [],
      id: 'derivative-route',
      math_status: 'valid',
      note: '导数法标准路线；不排斥等价表达。',
      source: 'teacher',
      terminal_ids: ['extrema'],
    }],
  };
}

function buildDiagnosisInput(evaluationCase: EvaluationCase): DiagnosisInput {
  const taskId = `diagnosis-quality-${evaluationCase.id}`;
  const { decisions, routes } = buildRoute(taskId);
  return {
    confirmed_evidence: [{
      confirmed: true,
      created_at: '2026-09-20T00:00:00.000Z',
      id: 'submission-1',
      invalidated: false,
      media_id: null,
      revision: 1,
      source: 'typed',
      task_id: taskId,
      text_md: evaluationCase.message,
      transcript_id: null,
    }],
    decisions,
    previous_hypotheses: [],
    previous_probes: [],
    private_reference_md: privateReferenceMd,
    prompt_md: problemMd,
    routes,
    task_id: taskId,
  };
}

function buildStrategyInput(input: DiagnosisInput, diagnosis: Diagnosis): StrategyInput {
  return {
    decisions: input.decisions,
    diagnosis,
    exposures: [],
    private_reference_md: input.private_reference_md,
    remaining_calls: 5,
    remaining_probes: 2,
    route_patch: null,
    user_action: 'attempt',
  };
}

function createConfig(environment: AppEnvironment) {
  return {
    get: (key: keyof AppEnvironment) => environment[key],
  } as unknown as ConfigService<AppEnvironment, true>;
}

function assertEvidenceReferences(diagnosis: Diagnosis, input: DiagnosisInput) {
  const submission = input.confirmed_evidence[0];
  if (!submission) throw new Error('evaluation input is missing its confirmed submission');
  for (const reference of diagnosis.evidence_refs) {
    if (
      reference.submission_id !== submission.id
      || reference.revision !== submission.revision
      || !submission.text_md.includes(reference.quote)
    ) {
      throw new Error(`diagnosis emitted an invalid evidence reference: ${JSON.stringify(reference)}`);
    }
  }
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  if (!environment.AI_API_KEY) throw new Error('AI_API_KEY is required for live diagnosis evaluation');

  const selectedCases = process.env.DIAGNOSIS_CASE
    ? cases.filter((item) => item.id === process.env.DIAGNOSIS_CASE)
    : cases;
  if (selectedCases.length === 0) {
    throw new Error(`Unknown DIAGNOSIS_CASE: ${process.env.DIAGNOSIS_CASE}`);
  }

  const provider = new OpenAiCompatibleModelPort(createConfig(environment));
  const diagnosisAgent = new DiagnosisAgent();
  const strategyAgent = new StrategyAgent();
  const results: EvaluationResult[] = [];

  for (const evaluationCase of selectedCases) {
    const diagnosisInput = buildDiagnosisInput(evaluationCase);
    const diagnosisResult = await diagnosisAgent.run(diagnosisInput, provider, {
      maxOutputTokens: 2_000,
      model: environment.AI_MODEL,
      signal: AbortSignal.timeout(environment.AI_TIMEOUT_MS),
    });
    const diagnosis = diagnosisResult.value;
    assertEvidenceReferences(diagnosis, diagnosisInput);
    if (!diagnosis.hypotheses.some((hypothesis) => hypothesis.kind === evaluationCase.expectedKind)) {
      throw new Error(
        `${evaluationCase.id} expected ${evaluationCase.expectedKind}, received ${diagnosis.hypotheses.map((item) => item.kind).join(',')}`,
      );
    }

    const strategyResult = await strategyAgent.run(
      buildStrategyInput(diagnosisInput, diagnosis),
      provider,
      {
        maxOutputTokens: 2_000,
        model: environment.AI_MODEL,
        signal: AbortSignal.timeout(environment.AI_TIMEOUT_MS),
      },
    );
    results.push({
      diagnosis,
      id: evaluationCase.id,
      model: diagnosisResult.response.model,
      strategy: strategyResult.value,
      usage: {
        diagnosisInput: diagnosisResult.response.usage.input,
        diagnosisOutput: diagnosisResult.response.usage.output,
        strategyInput: strategyResult.response.usage.input,
        strategyOutput: strategyResult.response.usage.output,
      },
    });
    console.info(JSON.stringify({
      action: strategyResult.value.action,
      artifact: strategyResult.value.expected_student_artifact,
      case: evaluationCase.id,
      focusGoal: diagnosis.focus_goal_key,
      hypothesisKinds: diagnosis.hypotheses.map((item) => `${item.kind}:${item.status}`),
      intervention: strategyResult.value.intervention,
      model: diagnosisResult.response.model,
      scaffoldLevel: strategyResult.value.scaffold_level,
    }));
  }

  if (results.length !== cases.length) {
    console.info(JSON.stringify({ selectedCases: results.map((result) => result.id), status: 'passed' }));
    return;
  }

  const concept = results.find((result) => result.id === 'concept-rule-reversed')!;
  const execution = results.find((result) => result.id === 'execution-copy-slip')!;
  const connection = results.find((result) => result.id === 'strategy-sign-to-monotonicity')!;
  const conceptTeaching = JSON.stringify({
    action: concept.strategy.action,
    artifact: concept.strategy.expected_student_artifact,
    intervention: concept.strategy.intervention,
  });
  const executionTeaching = JSON.stringify({
    action: execution.strategy.action,
    artifact: execution.strategy.expected_student_artifact,
    intervention: execution.strategy.intervention,
  });
  if (conceptTeaching === executionTeaching) {
    throw new Error('concept and execution cases received indistinguishable teaching actions');
  }

  const connectionTeaching = `${connection.strategy.expected_student_artifact}\n${connection.strategy.decision_reason}`;
  if (!/[单调|递增|递减|符号区间]/.test(connectionTeaching)) {
    throw new Error('strategy connection case did not focus on sign-to-monotonicity linkage');
  }
  if (/重新求导|求导公式/.test(connectionTeaching)) {
    throw new Error('strategy connection case unnecessarily reteaches differentiation');
  }

  console.info(JSON.stringify({
    cases: results.map((result) => ({
      action: result.strategy.action,
      hypothesisKinds: result.diagnosis.hypotheses.map((item) => `${item.kind}:${item.status}`),
      id: result.id,
      intervention: result.strategy.intervention,
      model: result.model,
      scaffoldLevel: result.strategy.scaffold_level,
      usage: result.usage,
    })),
    conceptExecutionTeachingDiffers: true,
    strategyAvoidedReteachingDerivative: true,
  }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Live diagnosis evaluation failed');
  process.exitCode = 1;
});
