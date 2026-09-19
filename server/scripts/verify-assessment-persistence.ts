import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { config as loadEnvironmentFile } from 'dotenv';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { AssessmentRepository } from '../src/features/assessment/assessment.repository.js';
import { HistoryService } from '../src/features/history/history.service.js';
import { LearningSessionService } from '../src/features/learning/learning-session.service.js';
import { ReportService } from '../src/features/report/report.service.js';

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const database = createDatabase(parseEnvironment(process.env));
  const databaseService = { client: database } as DatabaseService;
  const repository = new AssessmentRepository(databaseService);
  const learningSessions = new LearningSessionService(databaseService);
  const reports = new ReportService(databaseService);
  const history = new HistoryService(databaseService);
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const usernames = [`as-owner-${suffix}`, `as-other-${suffix}`];
  const userIds: string[] = [];

  try {
    for (const username of usernames) {
      const inserted = await database
        .insertInto('users')
        .values({
          cookie_token_hash: randomBytes(32),
          username,
          username_normalized: username,
        })
        .executeTakeFirstOrThrow();
      userIds.push(String(inserted.insertId));
    }
    const [ownerId, otherOwnerId] = userIds as [string, string];

    const createSession = async (userId: string, title: string) => {
      const inserted = await database
        .insertInto('sessions')
        .values({
          active_run_id: null,
          analysis_json: JSON.stringify({
            firstQuestion: '如何配方？',
            keyConditions: ['二次项系数为正'],
            knowledgePoints: ['配方法', '二次函数最值'],
            overview: '二次函数最值题',
            target: '求最小值',
          }),
          expires_at: new Date(Date.now() + 60_000),
          next_event_seq: 1,
          next_message_seq: 1,
          phase: 'learning',
          problem_content_markdown: '求 $f(x)=x^2-4x$ 的最小值。',
          problem_markdown: '求 $f(x)=x^2-4x$ 的最小值。',
          question_id: null,
          recognition_uncertain_json: null,
          title,
          topic: '二次函数',
          user_id: userId,
          version: 1,
        })
        .executeTakeFirstOrThrow();
      return String(inserted.insertId);
    };

    const sessionId = await createSession(ownerId, '独立检验事务测试');
    const prompt = '求函数 $g(x)=x^2-6x+5$ 的最小值。';
    const started = await repository.createAttempt(ownerId, sessionId, {
      candidate: {
        equivalenceGroup: `quadratic-minimum-${suffix}`,
        promptMarkdown: prompt,
        referenceAnswerMarkdown: '$g(x)=(x-3)^2-4$，最小值为 $-4$。',
        relation: 'near_transfer',
        rubric: ['使用配方法', '给出最小值'],
      },
      taskHash: hash(prompt),
      verification: { review: { model: 'fixture-review', verdict: 'accept' } },
    });
    const drafted = await repository.saveDraft(ownerId, started.id, {
      expectedVersion: started.version,
      kind: 'plan',
      markdown: '先配方，再利用平方项非负。',
    });
    const planned = await repository.lockPlan(ownerId, started.id, {
      expectedVersion: drafted.version,
      noPlan: false,
      planMarkdown: drafted.planDraftMarkdown,
    });
    const answered = await repository.saveDraft(ownerId, started.id, {
      expectedVersion: planned.version,
      kind: 'answer',
      markdown: '$g(x)=(x-3)^2-4$，所以最小值为 $-4$。',
    });
    const restored = await repository.getCurrentAttempt(ownerId, sessionId);
    if (
      restored.lockedPlanMarkdown !== '先配方，再利用平方项非负。'
      || restored.answerDraftMarkdown !== answered.answerDraftMarkdown
      || restored.phase !== 'check_answer'
    ) {
      throw new Error('assessment attempt did not restore locked plan and answer draft');
    }
    const frozen = await repository.freezeAnswer(ownerId, started.id, {
      answerMarkdown: restored.answerDraftMarkdown,
      expectedVersion: restored.version,
    });
    const resumed = await repository.freezeAnswer(ownerId, started.id, {
      answerMarkdown: restored.answerDraftMarkdown,
      expectedVersion: restored.version,
    });
    if (
      frozen.phase !== 'grading'
      || resumed.phase !== 'grading'
      || resumed.finalAnswerMarkdown !== restored.answerDraftMarkdown
    ) {
      throw new Error('frozen answer could not resume grading idempotently');
    }
    await repository.saveGrade(ownerId, started.id, {
      evidence: ['首次计划明确使用配方法', '最终计算中的常数项有误'],
      execution: 'incorrect',
      independentExecution: false,
      independentPlanning: true,
      independentTaskPass: false,
      limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
      planning: 'correct',
      summary: '计划方向有依据，但最终执行需要修正。',
    });
    const report = await reports.getReport(ownerId, sessionId);
    const reportedAttempt = report.attempts[0];
    if (
      report.original_status !== 'in_progress'
      || report.delayed_evidence !== 'not_evaluated'
      || reportedAttempt?.planning !== 'correct'
      || reportedAttempt.execution !== 'incorrect'
      || !reportedAttempt.independent_planning
      || reportedAttempt.independent_execution
      || reportedAttempt.independent_task_pass
    ) {
      throw new Error('evidence report did not keep original, planning, and execution separate');
    }
    const sourceSession = await learningSessions.getSession(ownerId, sessionId);
    const finishRequestId = `original-finish-${suffix}`;
    const finishReservation = await learningSessions.reserveTurn({
      assistanceMode: 'finish_problem',
      expectedVersion: sourceSession.record.version,
      message: '我认为最小值是 $-4$，但没有写出配方过程。',
      ownerId,
      requestId: finishRequestId,
      sessionId,
    });
    if (finishReservation.kind !== 'reserved') throw new Error('original finish unexpectedly replayed');
    await learningSessions.commitTurn({
      assistanceMode: 'finish_problem',
      currentVerdict: 'unknown',
      expectedVersion: finishReservation.expectedVersion,
      leaseToken: finishReservation.leaseToken,
      message: '我认为最小值是 $-4$，但没有写出配方过程。',
      ownerId,
      reply: '最终数值看起来可能一致，但缺少关键配方依据，当前证据不足。',
      requestId: finishRequestId,
      runId: finishReservation.runId,
      sessionId,
    });
    const unknownOriginalReport = await reports.getReport(ownerId, sessionId);
    if (unknownOriginalReport.original_status !== 'unknown') {
      throw new Error('a completion click without mathematical evidence was treated as complete');
    }

    const reassessmentPrompt = '抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？';
    const reassessment = await repository.createReassessment(ownerId, sessionId, {
      candidate: {
        equivalenceGroup: `quadratic-vertex-interpretation-${suffix}`,
        promptMarkdown: reassessmentPrompt,
        referenceAnswerMarkdown: '$y=(x-5)^2-4$，顶点纵坐标为 $-4$。',
        relation: 'near_transfer',
        rubric: ['建立顶点式', '给出顶点纵坐标'],
      },
      taskHash: hash(reassessmentPrompt),
      verification: { review: { model: 'fixture-review', verdict: 'accept' } },
    });
    const restoredReassessment = await repository.getCurrentAttempt(ownerId, sessionId);
    const activeReassessment = await repository.getActiveReassessment(ownerId, sessionId);
    const racedReassessment = await repository.createReassessment(ownerId, sessionId, {
      candidate: {
        equivalenceGroup: `should-not-be-created-${suffix}`,
        promptMarkdown: '这道候选题不应在已有活动重测时落库。',
        referenceAnswerMarkdown: '不应使用。',
        relation: 'near_transfer',
        rubric: ['不应使用'],
      },
      taskHash: hash(`should-not-be-created-${suffix}`),
      verification: { review: { model: 'fixture-review', verdict: 'accept' } },
    });
    const reassessmentReport = await reports.getReport(ownerId, sessionId);
    const reassessmentHistory = await history.getHistory(ownerId);
    if (
      reassessment.phase !== 'check_plan'
      || reassessment.sessionId === sessionId
      || restoredReassessment.id !== reassessment.id
      || activeReassessment?.id !== reassessment.id
      || racedReassessment.id !== reassessment.id
      || reassessmentReport.attempts.length !== 2
      || reassessmentHistory.entries.filter((entry) => entry.session_id === sessionId).length !== 1
      || reassessmentHistory.entries.some((entry) => entry.session_id === reassessment.sessionId)
    ) {
      throw new Error('linked reassessment was not restored or folded into report/history');
    }

    await repository.getCurrentAttempt(otherOwnerId, sessionId).then(
      () => { throw new Error('cross-owner assessment read unexpectedly succeeded'); },
      (error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error;
      },
    );
    await reports.getReport(otherOwnerId, sessionId).then(
      () => { throw new Error('cross-owner report read unexpectedly succeeded'); },
      (error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error;
      },
    );

    const duplicateSessionId = await createSession(ownerId, '重复检验任务拦截测试');
    await repository.createAttempt(ownerId, duplicateSessionId, {
      candidate: {
        equivalenceGroup: `different-group-${suffix}`,
        promptMarkdown: prompt,
        referenceAnswerMarkdown: '$g(x)=(x-3)^2-4$，最小值为 $-4$。',
        relation: 'near_transfer',
        rubric: ['使用配方法', '给出最小值'],
      },
      taskHash: hash(prompt),
      verification: { review: { model: 'fixture-review', verdict: 'accept' } },
    }).then(
      () => { throw new Error('an exact previously seen task was selected again'); },
      (error: unknown) => {
        if (!(error instanceof ConflictException)) throw error;
      },
    );

    const equivalentSessionId = await createSession(ownerId, '等价检验任务拦截测试');
    const equivalentPrompt = '求函数 $p(x)=x^2-10x+9$ 的最小值。';
    await repository.createAttempt(ownerId, equivalentSessionId, {
      candidate: {
        equivalenceGroup: `quadratic-minimum-${suffix}`,
        promptMarkdown: equivalentPrompt,
        referenceAnswerMarkdown: '$p(x)=(x-5)^2-16$，最小值为 $-16$。',
        relation: 'near_transfer',
        rubric: ['使用配方法', '给出最小值'],
      },
      taskHash: hash(equivalentPrompt),
      verification: { review: { model: 'fixture-review', verdict: 'accept' } },
    }).then(
      () => { throw new Error('a previously seen equivalence group was selected again'); },
      (error: unknown) => {
        if (!(error instanceof ConflictException)) throw error;
      },
    );

    await repository.saveDraft(ownerId, started.id, {
      expectedVersion: started.version,
      kind: 'answer',
      markdown: 'stale write',
    }).then(
      () => { throw new Error('stale assessment write unexpectedly succeeded'); },
      (error: unknown) => {
        if (!(error instanceof ConflictException)) throw error;
      },
    );

    const secondSessionId = await createSession(ownerId, '求助状态事务测试');
    const secondPrompt = '求函数 $h(x)=x^2-8x+7$ 的最小值。';
    const second = await repository.createAttempt(ownerId, secondSessionId, {
      candidate: {
        equivalenceGroup: `quadratic-minimum-help-${suffix}`,
        promptMarkdown: secondPrompt,
        referenceAnswerMarkdown: '$h(x)=(x-4)^2-9$，最小值为 $-9$。',
        relation: 'near_transfer',
        rubric: ['使用配方法', '给出最小值'],
      },
      taskHash: hash(secondPrompt),
      verification: { review: { model: 'fixture-review', verdict: 'accept' } },
    });
    const helped = await repository.requestHelp(ownerId, second.id, {
      currentMarkdown: '我准备先配方。',
      expectedVersion: second.version,
    });
    const helpedAfterRefresh = await repository.getCurrentAttempt(ownerId, secondSessionId);
    if (
      !helped.assistanceRequested
      || helped.helpExposed
      || !helped.helpSessionId
      || !helpedAfterRefresh.assistanceRequested
      || helpedAfterRefresh.helpExposed
      || helpedAfterRefresh.helpSessionId !== helped.helpSessionId
      || helpedAfterRefresh.planDraftMarkdown !== '我准备先配方。'
    ) {
      throw new Error('help request was not durably recorded before exposure');
    }

    const helpSession = await learningSessions.getSession(ownerId, helped.helpSessionId);
    if (
      helpSession.record.content !== secondPrompt
      || !helpSession.messages.some((message) => message.content === '我准备先配方。')
    ) {
      throw new Error('same-task help session did not preserve the assessment task and draft');
    }
    const requestId = `assessment-help-${suffix}`;
    const reservation = await learningSessions.reserveTurn({
      assistanceMode: 'hint',
      expectedVersion: helpSession.record.version,
      message: '请只给我一个最小提示。',
      ownerId,
      requestId,
      sessionId: helped.helpSessionId,
    });
    if (reservation.kind !== 'reserved') throw new Error('help turn unexpectedly replayed');
    await learningSessions.commitTurn({
      assistanceMode: 'hint',
      expectedVersion: reservation.expectedVersion,
      leaseToken: reservation.leaseToken,
      message: '请只给我一个最小提示。',
      ownerId,
      reply: '先观察二次项系数，并考虑把式子配成平方项。',
      requestId,
      runId: reservation.runId,
      sessionId: helped.helpSessionId,
    });
    const exposedAfterRefresh = await repository.getCurrentAttempt(ownerId, secondSessionId);
    if (!exposedAfterRefresh.helpExposed) {
      throw new Error('committed same-task help was not recorded as exposed');
    }

    console.info(
      `assessment persistence passed: attempt=${started.id}, version=${resumed.version}, ownerIsolation=true, reportOwnerIsolation=true, exactSeenRejected=true, equivalentSeenRejected=true, staleWriteRejected=true, gradingResume=true, originalUnknown=true, reportPlanning=true, reportExecution=false, reportTaskPass=false, reassessmentRestored=true, reassessmentRaceIdempotent=true, reassessmentReportCount=2, reassessmentHistoryFolded=true, sameTaskHelp=true, helpRequested=true, helpExposed=true`,
    );
  } finally {
    if (userIds.length) await database.deleteFrom('users').where('id', 'in', userIds).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Assessment persistence failed');
  process.exitCode = 1;
});
