import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { config as loadEnvironmentFile } from 'dotenv';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { PacketSchema } from '../src/contracts/domain.schema.js';
import { createDatabase } from '../src/database/database.factory.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { AssessmentRepository } from '../src/features/assessment/assessment.repository.js';
import { HistoryService } from '../src/features/history/history.service.js';
import { LearningSessionService } from '../src/features/learning/learning-session.service.js';
import { ReportService } from '../src/features/report/report.service.js';

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function hashHex(value: string) {
  return hash(value).toString('hex');
}

function preparedPacket(problemId: string, problemHash: string, version: string) {
  const checkedAt = new Date().toISOString();
  const decision = {
    acceptance_rule: '配方后正确读出最小值',
    common_gaps: ['忘记利用平方项非负'],
    entry_condition: '能将二次式配方',
    expected_artifact: '顶点式和最小值',
    goal: '用配方法求最值',
    goal_key: 'complete-square-minimum',
    id: 'decision-1',
    parent_goal_key: null,
    part_id: 'part-1',
    prerequisite_ids: [],
    source: 'teacher' as const,
  };
  const route = {
    decision_ids: [decision.id],
    evidence_refs: [],
    id: 'route-1',
    math_status: 'valid' as const,
    note: '消元后配方',
    source: 'teacher' as const,
    terminal_ids: [decision.id],
  };
  const prompt = '已知 $x+y=4$，求 $x^2+y^2$ 的最小值。';
  return PacketSchema.parse({
    blocking_issues: [],
    check_tasks: [{
      content_hash: hashHex(prompt),
      decisions: [decision],
      equivalence_group: 'quadratic-minimum-from-linear-constraint',
      execution_rubric: '正确消元、配方并给出最小值',
      id: 'prepared-check-1',
      planning_rubric: '计划中说明先消元再配方',
      prompt_md: prompt,
      reference_md: '代入 $y=4-x$ 后配方，最小值为 $8$。',
      relation: 'near_transfer',
      routes: [route],
      source_problem_id: problemId,
      verification: [{
        checked_at: checkedAt,
        kind: 'model_checked',
        reference: 'prepared-check-1',
        reviewer_or_model: 'fixture-preparation',
        status: 'pass',
        summary: '备课候选已做结构检查',
      }],
      verified: false,
    }],
    coverage_note: '用不同表征检验配方决策',
    decisions: [decision],
    problem_hash: problemHash,
    problem_id: problemId,
    ready: true,
    reference_md: '原题参考解析',
    reference_source: 'fixture-source',
    routes: [route],
    verification: [{
      checked_at: checkedAt,
      kind: 'source_reference',
      reference: `fixture:${problemId}:${problemHash}`,
      reviewer_or_model: 'fixture-source',
      status: 'pass',
      summary: '测试题源已核对',
    }],
    version,
  });
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
  const packetKeys: Array<{ problemHash: Buffer; version: string }> = [];

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

    const commitCorrectOriginal = async (targetSessionId: string) => {
      const source = await learningSessions.getSession(ownerId, targetSessionId);
      const requestId = `original-correct-${targetSessionId}-${suffix}`;
      const reservation = await learningSessions.reserveTurn({
        assistanceMode: 'finish_problem',
        expectedVersion: source.record.version,
        message: '配方得到 $(x-2)^2-4$，所以最小值是 $-4$。',
        ownerId,
        requestId,
        sessionId: targetSessionId,
      });
      if (reservation.kind !== 'reserved') {
        throw new Error('original correctness check unexpectedly replayed');
      }
      await learningSessions.commitTurn({
        assistanceMode: 'finish_problem',
        currentVerdict: 'correct',
        expectedVersion: reservation.expectedVersion,
        leaseToken: reservation.leaseToken,
        message: '配方得到 $(x-2)^2-4$，所以最小值是 $-4$。',
        ownerId,
        reply: '这次结论和关键依据已经核对。',
        requestId,
        runId: reservation.runId,
        sessionId: targetSessionId,
      });
    };

    const blockedSessionId = await createSession(ownerId, '原题未核对门禁测试');
    const blockedPrompt = '未完成原题核对时不应创建这道检验题。';
    await repository.createAttempt(ownerId, blockedSessionId, {
      candidate: {
        equivalenceGroup: `blocked-before-original-correct-${suffix}`,
        promptMarkdown: blockedPrompt,
        referenceAnswerMarkdown: '不应落库。',
        relation: 'near_transfer',
        rubric: ['不应落库'],
      },
      taskHash: hash(blockedPrompt),
      verification: { review: { model: 'fixture-review', verdict: 'accept' } },
    }).then(
      () => { throw new Error('assessment started before the original answer was correct'); },
      (error: unknown) => {
        if (!(error instanceof ConflictException)) throw error;
      },
    );

    const sessionId = await createSession(ownerId, '独立检验事务测试');
    await commitCorrectOriginal(sessionId);
    const preparedSessionId = await createSession(ownerId, '备课迁移题绑定测试');
    const preparedProblemId = `prepared-question-${suffix}`;
    const preparedProblemHash = hashHex('求 $f(x)=x^2-4x$ 的最小值。');
    const preparedVersion = hashHex(`prepared-version-${suffix}`);
    const packet = preparedPacket(preparedProblemId, preparedProblemHash, preparedVersion);
    const packetHash = Buffer.from(preparedProblemHash, 'hex');
    packetKeys.push({ problemHash: packetHash, version: preparedVersion });
    await database
      .insertInto('packets')
      .values({
        config_hash: 'assessment-persistence-fixture',
        model_id: 'fixture-preparation',
        packet_json: JSON.stringify(packet),
        problem_hash: packetHash,
        problem_id: preparedProblemId,
        prompt_version: 'fixture-v1',
        review_json: JSON.stringify({ verdict: 'accept' }),
        status: 'ready',
        version: preparedVersion,
      })
      .execute();
    await database
      .insertInto('events')
      .values({
        dependency_ids_json: JSON.stringify([]),
        event_type: 'preparation_bound',
        invalidated: 0,
        payload_json: JSON.stringify({
          packetVersion: preparedVersion,
          problemHash: preparedProblemHash,
          status: 'ready',
        }),
        seq: 1,
        session_id: preparedSessionId,
        subject_id: preparedProblemId,
      })
      .execute();
    const preparedSource = await repository.getSourceSession(ownerId, preparedSessionId);
    if (
      preparedSource.preparedPacketVersion !== preparedVersion
      || preparedSource.preparedCheckTasks.length !== 1
      || preparedSource.preparedCheckTasks[0]?.id !== 'prepared-check-1'
    ) {
      throw new Error('exact ready packet check task was not restored for assessment');
    }
    const auditRun = await repository.startModelRun(
      ownerId,
      preparedSessionId,
      'prepare',
      { operation: 'assessment-audit-fixture' },
    );
    const auditStartedAt = new Date().toISOString();
    await repository.recordModelNode(ownerId, auditRun, {
      finishedAt: new Date().toISOString(),
      inputHash: hashHex('assessment-audit-input'),
      modelId: 'fixture-assessment',
      nodeKey: 'prepared_task_guard_1',
      output: { reason: 'fixture accepted', verdict: 'accept' },
      promptVersion: 'assessment-v1',
      startedAt: auditStartedAt,
      status: 'completed',
      usage: {
        elapsedMs: 8,
        input: 20,
        kind: 'reported',
        output: 10,
        provider: 'fixture',
        providerRequestId: 'fixture-assessment-request',
      },
    });
    await repository.completeModelRun(ownerId, auditRun, 'completed');
    const persistedAudit = await database
      .selectFrom('runs as run')
      .innerJoin('requests as request', (join) => join
        .onRef('request.user_id', '=', 'run.user_id')
        .onRef('request.request_id', '=', 'run.request_id'))
      .innerJoin('node_runs as node', 'node.run_id', 'run.id')
      .select([
        'node.model_id',
        'node.node_key',
        'node.status as node_status',
        'request.status as request_status',
        'run.status as run_status',
        'node.usage_json',
      ])
      .where('run.id', '=', auditRun.runId)
      .executeTakeFirst();
    if (
      !persistedAudit
      || persistedAudit.node_key !== 'prepared_task_guard_1'
      || persistedAudit.model_id !== 'fixture-assessment'
      || persistedAudit.node_status !== 'completed'
      || persistedAudit.run_status !== 'completed'
      || persistedAudit.request_status !== 'succeeded'
      || !JSON.stringify(persistedAudit.usage_json).includes('reported')
    ) {
      throw new Error('assessment model node audit was not persisted');
    }
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
      transcriptId: '5001',
      transcriptRevision: 2,
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
      transcriptId: '5002',
      transcriptRevision: 3,
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
    const handwritingEvents = await database
      .selectFrom('events')
      .select(['payload_json', 'seq'])
      .where('session_id', '=', sessionId)
      .where('event_type', '=', 'assessment_handwriting_submitted')
      .orderBy('seq', 'asc')
      .execute();
    const handwritingPayloads = handwritingEvents.map((event) => (
      typeof event.payload_json === 'string'
        ? JSON.parse(event.payload_json) as Record<string, unknown>
        : event.payload_json as Record<string, unknown>
    ));
    if (
      handwritingEvents.length !== 2
      || handwritingPayloads[0]?.kind !== 'plan'
      || handwritingPayloads[0]?.transcriptId !== '5001'
      || handwritingPayloads[0]?.transcriptRevision !== 2
      || handwritingPayloads[1]?.kind !== 'answer'
      || handwritingPayloads[1]?.transcriptId !== '5002'
      || handwritingPayloads[1]?.transcriptRevision !== 3
      || handwritingEvents[1]!.seq !== handwritingEvents[0]!.seq + 1
    ) {
      throw new Error('assessment handwriting provenance was not transactionally persisted');
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
      report.original_status !== 'completed_without_recorded_help'
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
    await commitCorrectOriginal(duplicateSessionId);
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
    await commitCorrectOriginal(equivalentSessionId);
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
    await commitCorrectOriginal(secondSessionId);
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
      `assessment persistence passed: attempt=${started.id}, version=${resumed.version}, ownerIsolation=true, reportOwnerIsolation=true, exactSeenRejected=true, equivalentSeenRejected=true, staleWriteRejected=true, gradingResume=true, handwritingProvenance=true, originalUnknown=true, assessmentRequiresCorrectOriginal=true, reportPlanning=true, reportExecution=false, reportTaskPass=false, reassessmentRestored=true, reassessmentRaceIdempotent=true, reassessmentReportCount=2, reassessmentHistoryFolded=true, preparedCheckTaskBound=true, assessmentNodeAudit=true, sameTaskHelp=true, helpRequested=true, helpExposed=true`,
    );
  } finally {
    for (const packetKey of packetKeys) {
      await database
        .deleteFrom('packets')
        .where('problem_hash', '=', packetKey.problemHash)
        .where('version', '=', packetKey.version)
        .execute();
    }
    if (userIds.length) await database.deleteFrom('users').where('id', 'in', userIds).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Assessment persistence failed');
  process.exitCode = 1;
});
