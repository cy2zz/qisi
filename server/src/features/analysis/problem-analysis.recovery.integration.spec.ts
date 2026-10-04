import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { ModelPort, ModelRequest, ModelResponse } from '../../model/model.port.js';
import { AuthService } from '../auth/auth.service.js';
import { BankService } from '../bank/bank.service.js';
import { LearningSessionService } from '../learning/learning-session.service.js';
import { MediaService } from '../media/media.service.js';
import { QuestionImageLoader } from '../media/question-image-loader.js';
import { QuestionImageRecognitionService } from '../media/question-image-recognition.service.js';
import { PreparationService } from '../preparation/preparation.service.js';
import { ProblemAnalysisController } from './problem-analysis.controller.js';
import { ProblemAnalysisService, type TutorNodeRecord } from './problem-analysis.service.js';

const body = {
  assistanceMode: 'attempt', expectedVersion: 1, history: [], message: 'fixture attempt',
  problemMd: 'fixture problem', requestId: '11111111-1111-4111-8111-111111111111', sessionId: '91',
};
const guard = { actual_disclosed_ids: ['session-91:conditions'], disclosure_note: 'PRIVATE_GUARD_NOTE',
  math_note: 'PRIVATE_MATH_NOTE', verdict: 'accept', issues: [], whole_task_disclosed: false };

type Scenario = 'recovered' | 'rejected' | 'unknown' | 'malformed' | 'answer-citation-recovered' | 'answer-citation-rejected';
async function createHttpHarness(scenario: Scenario, submission = body) {
  const answerCase = scenario.startsWith('answer-citation');
  const decisionIds = ['conditions', 'method', 'target'].map(key => 'session-91:' + key);
  const sessions = {
    reserveTurn: vi.fn(async () => ({
      kind: 'reserved', deadlineAt: new Date(Date.now() + 90_000).toISOString(), expectedVersion: 1,
      history: [], leaseToken: 'fixture-lease', packetVersion: null, problemMd: submission.problemMd, runId: 'fixture-run',
      analysis: { firstQuestion: 'fixture question', keyConditions: ['fixture condition'], knowledgePoints: ['fixture topic'],
        overview: 'fixture overview', target: 'fixture target' }, teachingState: { exposures: [], probesShownByGoal: {} },
    })),
    recordTurnNode: vi.fn<(record: TutorNodeRecord) => Promise<void>>().mockResolvedValue(undefined),
    commitTurn: vi.fn<(input: Record<string, unknown>) => Promise<{ version: number }>>().mockResolvedValue({ version: 2 }),
    failTurn: vi.fn().mockResolvedValue(undefined),
  };
  let diagnoses = 0;
  let renders = 0;
  let guards = 0;
  const model: ModelPort = { generate: vi.fn(async (req: ModelRequest): Promise<ModelResponse> => {
    let parsed: unknown;
    switch (req.role) {
      case 'diagnosis':
        diagnoses += 1;
        parsed = { evidence_refs: answerCase ? (diagnoses === 1 || scenario === 'answer-citation-rejected'
          ? [{ quote: 'FABRICATED_CITATION', submission_id: submission.requestId, revision: 1 }]
          : [{ evidence_key: 'e0' }]) : [{ quote: submission.message, submission_id: submission.requestId, revision: 1 }],
        focus_goal_key: 'session-91:method', hypotheses: [{ id: 'fixture-h1', kind: 'strategy', status: 'candidate', explanation: 'fixture uncertainty', missing_evidence: 'fixture next step', evidence_refs: [] }], judgment: answerCase ? 'valid' : 'unknown', probe: null, route_review_needed: false,
        route_review_reason: '', satisfied_decision_ids: answerCase ? decisionIds : [], summary: 'fixture summary', task_id: 'session-91' }; break;
      case 'strategy':
        if (answerCase) {
          parsed = { action: 'complete', allowed_disclosures: [], allowed_facts: [{ decision_ids: decisionIds, source_ref: 'diagnosis.evidence_refs[0]', text_md: submission.message }],
            decision_reason: 'fixture checked complete work', expected_student_artifact: '', fading_reason: 'fixture acknowledgement',
            focus_goal_key: 'session-91:target', intervention: 'observe', probe: null, reserved_decisions: decisionIds, route_patch: null, scaffold_level: 0, task_id: 'session-91' };
          break;
        }
        parsed = { action: scenario === 'unknown' ? 'uncertain' : 'explain', allowed_disclosures: ['session-91:conditions'],
        allowed_facts: [{ decision_ids: ['session-91:conditions'], source_ref: '题目条件', text_md: 'fixture condition' }],
        decision_reason: 'fixture reason', expected_student_artifact: 'fixture artifact', fading_reason: 'fixture fading',
        focus_goal_key: 'session-91:method', intervention: 'goal_backchain', probe: null,
        reserved_decisions: ['session-91:method', 'session-91:target'], route_patch: null, scaffold_level: 1, task_id: 'session-91' }; break;
      case 'renderer': parsed = { text_md: answerCase ? '你的取项、组合因子和计算都对，系数是80。' : ++renders === 1 ? 'UNAPPROVED_CANDIDATE' : 'CHECKED_REWRITE' }; break;
      case 'guard':
        guards += 1;
        parsed = answerCase ? { ...guard, actual_disclosed_ids: [] } : scenario === 'malformed' ? { verdict: 'accept' }
          : { ...guard, verdict: scenario === 'unknown' ? 'unknown' : scenario === 'rejected' || guards === 1 ? 'revise' : 'accept' };
        break;
      default: throw new Error('unexpected fixture role');
    }
    return { parsed, model: 'fixture', provider: 'fixture', elapsedMs: 1, usage: { input: 20, output: 10, kind: 'reported' } };
  }) };
  const module = await Test.createTestingModule({
    controllers: [ProblemAnalysisController], providers: [
      { provide: AuthService, useValue: { authenticate: vi.fn().mockResolvedValue({ id: '7' }) } },
      { provide: BankService, useValue: {} }, { provide: ConfigService, useValue: { get: () => 'http://localhost:5173' } },
      { provide: QuestionImageLoader, useValue: {} }, { provide: QuestionImageRecognitionService, useValue: {} },
      { provide: MediaService, useValue: {} }, { provide: PreparationService, useValue: {} },
      { provide: ProblemAnalysisService, useValue: new ProblemAnalysisService(model) },
      { provide: LearningSessionService, useValue: sessions },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  return { app, sessions, model };
}

describe('POST /api/problems/chat recovery (fixture model/store; real Nest/SSE)', () => {
  it.each(['recovered', 'rejected', 'unknown', 'malformed'] as const)('commits and streams only the safe final result: %s', async scenario => {
    const { app, sessions, model } = await createHttpHarness(scenario);
    try {
      const response = await request(app.getHttpServer()).post('/api/problems/chat').set('Origin', 'http://localhost:5173')
        .send({ ...body, assistanceMode: scenario === 'unknown' ? 'finish_problem' : 'attempt' }).expect(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.text).toContain('event: chunk');
      expect(response.text).toContain('event: done');
      expect(response.text).not.toContain('event: error');
      expect(response.text).not.toContain('UNAPPROVED_CANDIDATE');
      expect(response.text).not.toContain('PRIVATE_');
      expect(sessions.commitTurn).toHaveBeenCalledOnce();
      const committed = sessions.commitTurn.mock.calls[0]?.[0];
      expect(JSON.stringify(committed)).not.toContain('UNAPPROVED_CANDIDATE');
      expect(JSON.stringify(committed)).not.toContain('PRIVATE_');
      if (scenario === 'recovered') {
        expect(response.text).toContain('CHECKED_REWRITE');
        expect(committed).toMatchObject({ reply: 'CHECKED_REWRITE', audit: { decisionIds: ['session-91:conditions'] } });
        expect(sessions.recordTurnNode.mock.calls.map(([record]) => record.nodeKey)).toEqual([
          'diagnosis', 'strategy', 'renderer', 'guard', 'renderer_rewrite', 'guard_recheck',
        ]);
      } else {
        expect(response.text).toContain('系统');
        expect(response.text).toContain('局部解释');
        expect(response.text).not.toContain('CHECKED_REWRITE');
        expect(committed).toMatchObject({ audit: undefined });
        if (scenario === 'unknown') expect(response.text).toContain('"currentVerdict":"unknown"');
      }
      expect(model.generate).toHaveBeenCalledTimes(scenario === 'unknown' ? 4 : scenario === 'malformed' ? 5 : 6);
      expect(sessions.failTurn).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});


describe('complete answer citation recovery (fixture model/store; real Nest/SSE)', () => {
  it.each(['answer-citation-recovered', 'answer-citation-rejected'] as const)('does not turn citation faults into a student error: %s', async scenario => {
    const submission = { ...body, history: [],
      problemMd: '在二项式 $(2x-1)^5$ 的展开式中，$x^3$ 的系数为________。',
      message: '其实就是从5个里面选3个2x，这样就是3次方了，那么C53＝10.然后2的3次方是8，-1的平方是1，那么最终结果是80.',
    };
    const { app, sessions, model } = await createHttpHarness(scenario, submission);
    try {
      const response = await request(app.getHttpServer()).post('/api/problems/chat').set('Origin', 'http://localhost:5173').send(submission).expect(200);
      expect(response.text).toContain('event: chunk');
      expect(response.text).toContain('event: done');
      expect(response.text).not.toContain('TURN_FAILED');
      expect(response.text).not.toContain('event: error');
      expect(response.text).not.toContain('FABRICATED_CITATION');
      expect(response.text).not.toContain('PRIVATE_');
      expect(sessions.failTurn).not.toHaveBeenCalled();
      expect(sessions.commitTurn).toHaveBeenCalledOnce();
      const nodes = sessions.recordTurnNode.mock.calls.map(([node]) => node);
      expect(nodes[0]).toMatchObject({ nodeKey: 'diagnosis', status: 'failed', output: null, usage: { input: 20, output: 10 } });
      const committed = sessions.commitTurn.mock.calls[0]?.[0];
      if (scenario === 'answer-citation-recovered') {
        expect(response.text).toContain('系数是80');
        expect(response.text).not.toContain('系统暂时未能');
        expect(nodes.map(node => node.nodeKey)).toEqual(['diagnosis','diagnosis_repair','strategy','renderer','guard']);
        expect(nodes[1]?.output).toMatchObject({ judgment: 'valid', evidence_refs: [{ submission_id: submission.requestId, revision: 1, quote: submission.message }] });
        expect(committed).toMatchObject({ audit: { decisionIds: [], scaffoldLevel: 0, wholeTaskDisclosed: false } });
        expect(model.generate).toHaveBeenCalledTimes(5);
      } else {
        expect(response.text).toContain('系统暂时未能');
        expect(response.text).not.toContain('系数是80');
        expect(committed).toMatchObject({ audit: undefined });
        expect(nodes.every(node => node.output === null && node.status === 'failed')).toBe(true);
        expect(model.generate).toHaveBeenCalledTimes(2);
      }
    } finally { await app.close(); }
  });
});
