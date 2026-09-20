import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { config as loadEnvironmentFile } from 'dotenv';
import { DiagnosisAgent } from '../src/agents/diagnosis/index.js';
import { PreparationAgent } from '../src/agents/preparation/index.js';
import { StrategyAgent } from '../src/agents/strategy/index.js';
import type {
  Decision,
  DiagnosisInput,
  PreparationInput,
  Problem,
  Route,
  StrategyInput,
} from '../src/contracts/domain.schema.js';
import {
  environmentFilePaths,
  parseEnvironment,
  type AppEnvironment,
} from '../src/config/env.js';
import { OpenAiCompatibleModelPort } from '../src/model/openai-compatible-model.port.js';

const taskId = 'alternative-route-am-gm';
const problemMarkdown = '已知函数 $f(x)=x+\\frac{1}{x}$，$x>0$。讨论单调性并求最小值。';
const studentRouteMarkdown = [
  '因为 $x>0$，由均值不等式：',
  '$$x+\\frac1x\\geq 2\\sqrt{x\\cdot\\frac1x}=2,$$',
  '当且仅当 $x=1$ 时取等，所以最小值是 $2$。',
].join('\n');
const privateReferenceMarkdown = [
  "$f'(x)=1-\\frac1{x^2}$。",
  "在 $(0,1)$ 上 $f'(x)<0$，在 $(1,+\\infty)$ 上 $f'(x)>0$，故先减后增，$x=1$ 时最小值为 $2$。",
  'AM–GM 能独立、正确地得到最小值及取等条件，但不能据此直接得到完整单调区间；这是求最值的合法学生异解。',
].join('\n');

function createConfig(environment: AppEnvironment) {
  return {
    get: (key: keyof AppEnvironment) => environment[key],
  } as unknown as ConfigService<AppEnvironment, true>;
}

function buildTeacherRoute(): { decisions: Decision[]; routes: Route[] } {
  const decisions: Decision[] = [
    {
      acceptance_rule: '导数及定义域处理正确。',
      common_gaps: ['concept', 'execution'],
      entry_condition: '选择导数路线。',
      expected_artifact: "写出 $f'(x)=1-\\frac1{x^2}$。",
      goal: '正确求导',
      goal_key: `${taskId}:differentiate`,
      id: 'differentiate',
      parent_goal_key: null,
      part_id: 'part-1',
      prerequisite_ids: [],
      source: 'teacher',
    },
    {
      acceptance_rule: '写出导数正负区间并正确连接原函数增减。',
      common_gaps: ['strategy', 'condition', 'representation'],
      entry_condition: '导数已正确写出。',
      expected_artifact: '说明函数在 $(0,1)$ 递减、在 $(1,+\\infty)$ 递增。',
      goal: '由导数符号得到单调区间',
      goal_key: `${taskId}:monotonicity`,
      id: 'monotonicity',
      parent_goal_key: `${taskId}:differentiate`,
      part_id: 'part-1',
      prerequisite_ids: ['differentiate'],
      source: 'teacher',
    },
    {
      acceptance_rule: '最小值与取等位置正确。',
      common_gaps: ['strategy', 'execution'],
      entry_condition: '单调性或其他合法最值路线已经成立。',
      expected_artifact: '得到 $x=1$ 时最小值为 $2$。',
      goal: '确定最小值与取等条件',
      goal_key: `${taskId}:minimum`,
      id: 'minimum',
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
      note: '教师导数路线。',
      source: 'teacher',
      terminal_ids: ['minimum'],
    }],
  };
}

function buildProblem(): Problem {
  return {
    asset_ids: [],
    bank_version: 'live-evaluation',
    content_hash: createHash('sha256').update(problemMarkdown).digest('hex'),
    id: taskId,
    is_official: false,
    issues: [],
    source: 'AT16 live model review fixture',
    statement_md: problemMarkdown,
    status: 'ready',
    topic_tags: ['函数', '导数', '均值不等式', '最值'],
  };
}

function buildDiagnosisInput(): DiagnosisInput {
  const { decisions, routes } = buildTeacherRoute();
  return {
    confirmed_evidence: [{
      confirmed: true,
      created_at: '2026-09-20T00:00:00.000Z',
      id: 'student-am-gm-route',
      invalidated: false,
      media_id: null,
      revision: 1,
      source: 'typed',
      task_id: taskId,
      text_md: studentRouteMarkdown,
      transcript_id: null,
    }],
    decisions,
    previous_hypotheses: [],
    previous_probes: [],
    private_reference_md: privateReferenceMarkdown,
    prompt_md: problemMarkdown,
    routes,
    task_id: taskId,
  };
}

function buildRouteReviewInput(): PreparationInput {
  return {
    evidence_refs: [{
      quote: '由均值不等式',
      revision: 1,
      submission_id: 'student-am-gm-route',
    }],
    mode: 'route_review',
    problem: buildProblem(),
    reference_material_md: privateReferenceMarkdown,
    student_route_md: studentRouteMarkdown,
  };
}

function assertStudentRouteIsPreserved(patch: Awaited<ReturnType<PreparationAgent['run']>>) {
  if (patch.mode !== 'route_review') throw new Error('route review returned a full preparation packet');
  const studentDecisionIds = new Set(
    patch.patch.new_decisions
      .filter((decision) => decision.source === 'student')
      .map((decision) => decision.id),
  );
  const acceptedStudentRoute = patch.patch.new_routes.find((route) => (
    route.source === 'student'
    && route.math_status === 'valid'
    && route.decision_ids.some((decisionId) => studentDecisionIds.has(decisionId))
  ));
  if (!acceptedStudentRoute) {
    throw new Error(`route patch lost the valid student-authored subroute: ${JSON.stringify(patch.patch)}`);
  }
  if (!patch.patch.verification.some((item) => item.status === 'pass')) {
    throw new Error('route patch has no passing verification record');
  }
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  if (!environment.AI_API_KEY) throw new Error('AI_API_KEY is required for live route evaluation');

  const provider = new OpenAiCompatibleModelPort(createConfig(environment));
  const callOptions = () => ({
    maxOutputTokens: 4_000,
    model: environment.AI_MODEL,
    signal: AbortSignal.timeout(environment.AI_TIMEOUT_MS),
  });
  const diagnosisAgent = new DiagnosisAgent();
  const preparationAgent = new PreparationAgent();
  const strategyAgent = new StrategyAgent();
  const diagnosisInput = buildDiagnosisInput();

  const diagnosisResult = await diagnosisAgent.run(diagnosisInput, provider, callOptions());
  const diagnosisNarrative = [
    diagnosisResult.value.summary,
    diagnosisResult.value.route_review_reason,
    ...diagnosisResult.value.hypotheses.map((hypothesis) => hypothesis.explanation),
  ].join('\n');
  if (!diagnosisResult.value.satisfied_decision_ids.includes('minimum')) {
    throw new Error(
      `valid AM-GM minimum result was not credited: ${JSON.stringify(diagnosisResult.value)}`,
    );
  }
  if (!diagnosisResult.value.route_review_needed) {
    throw new Error('unlisted valid AM-GM route did not request route review');
  }
  if (!diagnosisResult.value.focus_goal_key.endsWith(':monotonicity')) {
    throw new Error(`remaining monotonicity gap was not isolated: ${diagnosisResult.value.focus_goal_key}`);
  }
  if (!/(正确|有效).*(异解|路线)|(异解|路线).*(正确|有效)/s.test(diagnosisNarrative)) {
    throw new Error(`diagnosis did not explicitly accept the local AM-GM result: ${diagnosisNarrative}`);
  }
  if (/均值不等式.*错误|AM.?GM.*错误/.test(diagnosisNarrative)) {
    throw new Error(`diagnosis treated the valid AM-GM route as a mathematical error: ${diagnosisNarrative}`);
  }

  const routeReview = await preparationAgent.run(buildRouteReviewInput(), provider, callOptions());
  assertStudentRouteIsPreserved(routeReview);
  if (routeReview.mode !== 'route_review') return;

  const strategyInput: StrategyInput = {
    decisions: [...diagnosisInput.decisions, ...routeReview.patch.new_decisions],
    diagnosis: diagnosisResult.value,
    exposures: [],
    private_reference_md: privateReferenceMarkdown,
    remaining_calls: 3,
    remaining_probes: 2,
    route_patch: routeReview.patch,
    user_action: 'propose_route',
  };
  const strategyResult = await strategyAgent.run(strategyInput, provider, callOptions());
  const teachingTarget = `${strategyResult.value.expected_student_artifact}\n${strategyResult.value.decision_reason}`;
  if (!/[单调|递增|递减]/.test(teachingTarget)) {
    throw new Error('accepted AM-GM route did not keep the separate monotonicity gap visible');
  }
  if (/均值不等式.*错误|AM.?GM.*错误|重新.*最小值/.test(teachingTarget)) {
    throw new Error('strategy treated the accepted AM-GM route as an error');
  }

  console.info(JSON.stringify({
    action: strategyResult.value.action,
    diagnosis: {
      focusGoal: diagnosisResult.value.focus_goal_key,
      judgment: diagnosisResult.value.judgment,
      locallySatisfied: diagnosisResult.value.satisfied_decision_ids,
      routeReviewNeeded: diagnosisResult.value.route_review_needed,
    },
    model: diagnosisResult.response.model,
    routePatch: {
      decisions: routeReview.patch.new_decisions.map((decision) => ({
        goal: decision.goal,
        source: decision.source,
      })),
      mathStatus: routeReview.patch.math_status,
      routes: routeReview.patch.new_routes.map((route) => ({
        id: route.id,
        source: route.source,
      })),
    },
    scaffoldLevel: strategyResult.value.scaffold_level,
    separateMonotonicityGap: true,
    studentAuthorshipPreserved: true,
    usage: {
      diagnosis: diagnosisResult.response.usage,
      preparation: routeReview.response.usage,
      strategy: strategyResult.response.usage,
    },
  }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Live alternative-route evaluation failed');
  process.exitCode = 1;
});
