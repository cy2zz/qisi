import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { beforeAll, describe, expect, it } from 'vitest';
import { environmentFilePaths, parseEnvironment, type AppEnvironment } from '../../config/env.js';
import { DiagnosisSchema, GuardResultSchema, StrategySchema } from '../../contracts/domain.schema.js';
import { OpenAiCompatibleModelPort } from '../../model/openai-compatible-model.port.js';
import { ProblemAnalysisService, type TutorNodeRecord, type TutorTurnResult } from './problem-analysis.service.js';

// Opt-in only. Real ModelPort, synthetic IDs/context; no StorePort, HTTP mutation or database connection.
// This is a bounded sample, not a replay of the user's omitted history or a learning-effect assessment.
describe.skipIf(process.env.QISI_EQUIVALENT_ROUTE_LIVE !== '1')('B07 equivalent-route live model sample', () => {
  let model: OpenAiCompatibleModelPort;
  beforeAll(async () => {
    const values: Record<string, unknown> = { ...process.env };
    for (const path of environmentFilePaths('development')) {
      let content: string;
      try { content = await readFile(resolve(path), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      for (const [key, value] of Object.entries(parse(content))) if (values[key] === undefined) values[key] = value;
    }
    const environment = parseEnvironment(values);
    if (!environment.AI_API_KEY) throw new Error('Live sample requires the configured provider; no fixture fallback.');
    model = new OpenAiCompatibleModelPort(new ConfigService<AppEnvironment, true>(environment));
  });

  const cases = [
    { id: 'complementary-selection', judgment: 'valid', message: '从5个里面选3个2x,那就是C53，这个是10，然后(2x)的3次方是8，-1的平方是1.所以最终是80.我的思路不对吗' },
    { id: 'missing-multiplicity', judgment: 'invalid', message: '从5个里面选3个2x，剩下两个选-1。2的3次方是8，-1的平方是1，所以x的3次方的系数就是8，不用再乘选法数。' },
  ] as const;

  it.each(cases)('$id', async sample => {
    const sessionId = 'live-equivalence-' + sample.id;
    const nodes: TutorNodeRecord[] = [];
    const startedAt = new Date().toISOString();
    const start = performance.now();
    let result: TutorTurnResult | undefined;
    let passed = false;
    try {
      result = await new ProblemAnalysisService(model).reply({
        sessionId, requestId: '11111111-1111-4111-8111-' + (sample.judgment === 'valid' ? '000000000001' : '000000000002'),
        assistanceMode: 'attempt',
        problemMd: '在二项式 $(2x-1)^5$ 的展开式中，$x^3$ 的系数为__________。',
        analysis: {
          overview: '二项式系数问题；参考通项记为 C(5,k)(2x)^{5-k}(-1)^k。',
          knowledgePoints: ['二项式定理', '组合数'], keyConditions: ['二项式为(2x-1)^5', '目标项含x^3'],
          target: '求x^3的系数。', firstQuestion: '怎样选出含x^3的项？',
        },
        // Deliberately retain a standard k=2 convention and stale uncertainty as pressure context.
        history: [
          { role: 'guide', content: '若把k定义为选择-1的次数，通项可写成C(5,k)(2x)^{5-k}(-1)^k。' },
          { role: 'student', content: 'k=2的时候，但组合数我还没弄懂。' },
          { role: 'guide', content: '系统暂时未完成核对，这不是判定你答错。' },
        ],
        message: sample.message, teachingState: { exposures: [], probesShownByGoal: {} },
      }, new AbortController().signal, undefined, async node => { nodes.push(node); });
      const diagnosis = DiagnosisSchema.parse(nodes.find(node => node.nodeKey === 'diagnosis')?.output);
      const strategy = StrategySchema.parse([...nodes].reverse().find(node => node.nodeKey.startsWith('strategy') && node.status === 'completed')?.output);
      const guard = GuardResultSchema.parse([...nodes].reverse().find(node => node.nodeKey.startsWith('guard') && node.status === 'completed')?.output);
      expect(diagnosis.judgment).toBe(sample.judgment);
      expect(diagnosis.route_review_needed).toBe(false);
      expect(guard.verdict).toBe('accept');
      expect(result.audit).toBeDefined();
      expect(result.reply).not.toContain('系统暂时未能');
      expect(nodes.length).toBeLessThanOrEqual(7);
      expect(performance.now() - start).toBeLessThan(90_000);
      if (sample.judgment === 'valid') {
        expect(diagnosis.satisfied_decision_ids).toEqual(expect.arrayContaining(['conditions', 'method', 'target'].map(key => 'session-' + sessionId + ':' + key)));
        expect(strategy.action).toBe('complete');
        expect(strategy.scaffold_level).toBe(0);
        expect(result.audit?.decisionIds).toEqual([]);
        expect(result.audit?.wholeTaskDisclosed).toBe(false);
        expect(result.reply).toContain('80');
      } else {
        expect(strategy.action).not.toBe('complete');
        expect(result.currentVerdict).toBeUndefined();
        expect(strategy.scaffold_level).toBeLessThanOrEqual(1);
      }
      passed = true;
    } finally {
      // Never save private diagnosis summaries, Guard notes, candidate strategy text, env or full history.
      const evidenceDir = resolve('../artifacts/acceptance/B07-20260930-equivalent-route');
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(resolve(evidenceDir, 'live-' + sample.id + '.json'), JSON.stringify({
        caseId: sample.id, kind: 'real-model-synthetic-context', startedAt, finishedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - start), result: passed ? 'passed' : 'failed',
        expectedJudgment: sample.judgment, reply: result?.reply ?? null, audit: result?.audit ?? null,
        databaseWrites: 0, limitations: 'Two bounded samples; synthetic context, not full session replay or student learning evaluation.',
        nodes: nodes.map(node => {
          const diagnosis = node.nodeKey === 'diagnosis' ? DiagnosisSchema.safeParse(node.output) : null;
          const strategy = node.nodeKey.startsWith('strategy') ? StrategySchema.safeParse(node.output) : null;
          const guard = node.nodeKey.startsWith('guard') ? GuardResultSchema.safeParse(node.output) : null;
          return { nodeKey: node.nodeKey, status: node.status, modelId: node.modelId, promptVersion: node.promptVersion,
            usage: node.usage ? { input: node.usage.input, output: node.usage.output, kind: node.usage.kind, elapsedMs: node.usage.elapsedMs,
              provider: node.usage.provider, reasoningEffort: node.usage.reasoningEffort } : null,
            ...(diagnosis?.success ? { judgment: diagnosis.data.judgment, routeReviewNeeded: diagnosis.data.route_review_needed,
              satisfiedDecisions: diagnosis.data.satisfied_decision_ids.length } : {}),
            ...(strategy?.success ? { action: strategy.data.action, scaffoldLevel: strategy.data.scaffold_level } : {}),
            ...(guard?.success ? { verdict: guard.data.verdict, actualDisclosedIds: guard.data.actual_disclosed_ids, wholeTaskDisclosed: guard.data.whole_task_disclosed } : {}) };
        }),
      }, null, 2) + '\n', 'utf8');
    }
  }, 100_000);
});
