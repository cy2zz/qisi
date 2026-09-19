import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { config as loadEnvironmentFile } from 'dotenv';
import { sql } from 'kysely';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { AssessmentRepository } from '../src/features/assessment/assessment.repository.js';
import { LearningSessionService } from '../src/features/learning/learning-session.service.js';
import { DeleteService } from '../src/shared/delete.js';
import { runRetentionCleanup } from '../src/shared/retention.js';

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const database = createDatabase(parseEnvironment(process.env));
  const databaseService = { client: database } as DatabaseService;
  const assessment = new AssessmentRepository(databaseService);
  const deletion = new DeleteService(databaseService);
  const learning = new LearningSessionService(databaseService);
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  let userId = '';
  let paperId = '';
  let questionId = '';
  let paperQuestionId = '';

  const createSession = (title: string) => learning.createSession({
    analysis: {
      firstQuestion: '先写出什么？',
      keyConditions: ['二次项系数为正'],
      knowledgePoints: ['配方法'],
      overview: '这是一道二次函数最值题。',
      target: '求函数最小值',
    },
    content: '求 $f(x)=x^2-4x$ 的最小值。',
    ownerId: userId,
    problemMd: '求 $f(x)=x^2-4x$ 的最小值。',
    questionId,
    title,
    topic: '二次函数',
  });

  try {
    const username = `privacy-owner-${suffix}`;
    const user = await database.insertInto('users').values({
      cookie_token_hash: randomBytes(32),
      username,
      username_normalized: username,
    }).executeTakeFirstOrThrow();
    userId = String(user.insertId);

    const paper = await database.insertInto('paper').values({
      exam_type: '验收测试',
      exam_year: 2026,
      is_official: 0,
      metadata_json: null,
      paper_code: `privacy-paper-${suffix}`,
      region: null,
      status: 'ready',
      subject: '数学',
      title: '隐私清理验收试卷',
    }).executeTakeFirstOrThrow();
    paperId = String(paper.insertId);
    const question = await database.insertInto('question').values({
      analysis_image_object_key: null,
      analysis_image_url: null,
      analysis_markdown: '$f(x)=(x-2)^2-4$。',
      metadata_json: null,
      question_code: `privacy-question-${suffix}`,
      question_image_object_key: null,
      question_image_url: null,
      statement_markdown: '求 $f(x)=x^2-4x$ 的最小值。',
      status: 'ready',
    }).executeTakeFirstOrThrow();
    questionId = String(question.insertId);
    const paperQuestion = await database.insertInto('paper_question').values({
      metadata_json: null,
      paper_id: paperId,
      question_id: questionId,
      question_number: 1,
    }).executeTakeFirstOrThrow();
    paperQuestionId = String(paperQuestion.insertId);

    const draftSession = await createSession('临时稿保留验收');
    const prompt = '求 $g(x)=x^2-6x+5$ 的最小值。';
    const started = await assessment.createAttempt(userId, draftSession.id, {
      candidate: {
        equivalenceGroup: `privacy-draft-${suffix}`,
        promptMarkdown: prompt,
        referenceAnswerMarkdown: '$g(x)=(x-3)^2-4$，最小值为 $-4$。',
        relation: 'near_transfer',
        rubric: ['配方', '给出最小值'],
      },
      taskHash: hash(prompt),
      verification: { fixture: true },
    });
    const planDraft = await assessment.saveDraft(userId, started.id, {
      expectedVersion: started.version,
      kind: 'plan',
      markdown: '先配方，再用平方项非负。',
    });
    const planned = await assessment.lockPlan(userId, started.id, {
      expectedVersion: planDraft.version,
      noPlan: false,
      planMarkdown: planDraft.planDraftMarkdown,
    });
    const answerDraft = await assessment.saveDraft(userId, started.id, {
      expectedVersion: planned.version,
      kind: 'answer',
      markdown: '$g(x)=(x-3)^2-4$，所以最小值为 $-4$。',
    });
    await assessment.freezeAnswer(userId, started.id, {
      answerMarkdown: answerDraft.answerDraftMarkdown,
      expectedVersion: answerDraft.version,
    });
    await sql`update check_attempts set db_update_time = ${new Date('2026-09-17T10:00:00.000Z')} where id = ${started.id}`
      .execute(database);

    const firstCleanup = await runRetentionCleanup(
      database,
      new Date('2026-09-19T12:00:00.000Z'),
    );
    const retainedAttempt = await database.selectFrom('check_attempts').select([
      'answer_draft_markdown',
      'final_answer_markdown',
      'locked_plan_markdown',
      'plan_draft_markdown',
    ]).where('id', '=', started.id).executeTakeFirstOrThrow();
    if (
      firstCleanup.clearedDraftCount !== 1
      || retainedAttempt.plan_draft_markdown !== ''
      || retainedAttempt.answer_draft_markdown !== ''
      || retainedAttempt.locked_plan_markdown !== '先配方，再用平方项非负。'
      || retainedAttempt.final_answer_markdown !== '$g(x)=(x-3)^2-4$，所以最小值为 $-4$。'
      || firstCleanup.imageRetention !== 'not_persisted'
    ) {
      throw new Error('24-hour cleanup did not clear only temporary drafts');
    }

    const expired = await createSession('七天过期验收');
    await database.updateTable('sessions')
      .set({ expires_at: new Date('2026-09-19T11:59:59.000Z') })
      .where('id', '=', expired.id)
      .execute();
    const expiryCleanup = await runRetentionCleanup(
      database,
      new Date('2026-09-19T12:00:00.000Z'),
    );
    const expiredSession = await database.selectFrom('sessions')
      .select('id').where('id', '=', expired.id).executeTakeFirst();
    const expiredMessages = await database.selectFrom('learning_messages')
      .select('id').where('session_id', '=', expired.id).execute();
    if (expiredSession || expiredMessages.length || expiryCleanup.deletedSessionCount !== 1) {
      throw new Error('expired session private data was not deleted by cascade');
    }

    const root = await createSession('主动删除验收');
    const reassessment = await createSession('主动删除·重测');
    const help = await createSession('主动删除·检验求助');
    await database.insertInto('events').values([
      {
        dependency_ids_json: '[]',
        event_type: 'assessment_reassessment_started',
        invalidated: 0,
        payload_json: JSON.stringify({ rootSessionId: root.id }),
        seq: 1,
        session_id: reassessment.id,
        subject_id: root.id,
      },
      {
        dependency_ids_json: '[]',
        event_type: 'assessment_help_session_started',
        invalidated: 0,
        payload_json: JSON.stringify({ sourceSessionId: reassessment.id }),
        seq: 1,
        session_id: help.id,
        subject_id: 'fixture-attempt',
      },
    ]).execute();
    const requestId = `privacy-delete-${suffix}`;
    const reservation = await learning.reserveTurn({
      assistanceMode: 'hint',
      expectedVersion: root.version,
      message: '我需要一点提示。',
      ownerId: userId,
      requestId,
      sessionId: root.id,
    });
    if (reservation.kind !== 'reserved') throw new Error('deletion fixture unexpectedly replayed');
    const deleted = await deletion.deleteSession(userId, root.id);
    const remainingLinkedSessions = await database.selectFrom('sessions').select('id')
      .where('id', 'in', [root.id, reassessment.id, help.id]).execute();
    if (deleted.deletedSessionCount !== 3 || remainingLinkedSessions.length) {
      throw new Error('active deletion did not remove root and linked private sessions');
    }
    await learning.commitTurn({
      assistanceMode: 'hint',
      expectedVersion: reservation.expectedVersion,
      leaseToken: reservation.leaseToken,
      message: '我需要一点提示。',
      ownerId: userId,
      reply: '这条迟到结果不应被保存。',
      requestId,
      runId: reservation.runId,
      sessionId: root.id,
    }).then(
      () => { throw new Error('late provider result recreated a deleted session'); },
      (error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error;
      },
    );

    const afterDeletionSession = await createSession('历史不完整后检验');
    const afterDeletionPrompt = '求 $h(x)=x^2-8x+7$ 的最小值。';
    const afterDeletionAttempt = await assessment.createAttempt(userId, afterDeletionSession.id, {
      candidate: {
        equivalenceGroup: `privacy-after-delete-${suffix}`,
        promptMarkdown: afterDeletionPrompt,
        referenceAnswerMarkdown: '$h(x)=(x-4)^2-9$，最小值为 $-9$。',
        relation: 'near_transfer',
        rubric: ['配方', '给出最小值'],
      },
      taskHash: hash(afterDeletionPrompt),
      verification: { fixture: true },
    });
    const publicRows = await Promise.all([
      database.selectFrom('paper').select('id').where('id', '=', paperId).executeTakeFirst(),
      database.selectFrom('question').select('id').where('id', '=', questionId).executeTakeFirst(),
      database.selectFrom('paper_question').select('id').where('id', '=', paperQuestionId).executeTakeFirst(),
    ]);
    if (afterDeletionAttempt.firstSeenEligible || publicRows.some((row) => !row)) {
      throw new Error('deletion washed first-seen eligibility or changed public question-bank rows');
    }

    console.info(
      'privacy retention passed: draftsCleared=1, lockedAndFinalPreserved=true, imagesNotPersisted=true, expiredCascade=true, linkedDeleteCount=3, lateCommitRejected=true, historyIncomplete=true, futureFirstSeenEligible=false, questionBankUnaffected=true',
    );
  } finally {
    if (userId) await database.deleteFrom('users').where('id', '=', userId).execute();
    if (paperQuestionId) await database.deleteFrom('paper_question').where('id', '=', paperQuestionId).execute();
    if (questionId) await database.deleteFrom('question').where('id', '=', questionId).execute();
    if (paperId) await database.deleteFrom('paper').where('id', '=', paperId).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Privacy retention verification failed');
  process.exitCode = 1;
});
