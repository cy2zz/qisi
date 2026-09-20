import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config as loadEnvironmentFile } from 'dotenv';
import { sql } from 'kysely';
import { environmentFilePaths, parseEnvironment, type AppEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { AssessmentRepository } from '../src/features/assessment/assessment.repository.js';
import { PrivateMediaStorageService } from '../src/features/media/private-media-storage.service.js';
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
  const storageRoot = await mkdtemp(join(tmpdir(), 'qisi-privacy-retention-'));
  const storage = new PrivateMediaStorageService({
    get: () => storageRoot,
  } as unknown as ConfigService<AppEnvironment, true>);
  const deletion = new DeleteService(databaseService, storage);
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
  const markOriginalCorrect = async (sessionId: string) => {
    await database.transaction().execute(async (transaction) => {
      const session = await transaction.selectFrom('sessions')
        .select('next_event_seq')
        .where('id', '=', sessionId)
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await transaction.insertInto('events').values({
        dependency_ids_json: '[]',
        event_type: 'current_answer_checked',
        invalidated: 0,
        payload_json: JSON.stringify({ independent: false, verdict: 'correct' }),
        seq: session.next_event_seq,
        session_id: sessionId,
        subject_id: `privacy-check-${sessionId}`,
      }).execute();
      await transaction.updateTable('sessions').set({
        next_event_seq: session.next_event_seq + 1,
        phase: 'answer_checked',
      }).where('id', '=', sessionId).where('user_id', '=', userId).executeTakeFirstOrThrow();
    });
  };

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
    await markOriginalCorrect(draftSession.id);
    await learning.saveDraft(userId, draftSession.id, '学习页尚未发送的临时草稿');
    await database.updateTable('learning_drafts')
      .set({ expires_at: new Date('2026-09-18T11:59:59.000Z') })
      .where('session_id', '=', draftSession.id)
      .execute();
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
    const expiredLearningDraft = await database.selectFrom('learning_drafts')
      .select('session_id')
      .where('session_id', '=', draftSession.id)
      .executeTakeFirst();
    if (
      firstCleanup.clearedDraftCount !== 2
      || expiredLearningDraft
      || retainedAttempt.plan_draft_markdown !== ''
      || retainedAttempt.answer_draft_markdown !== ''
      || retainedAttempt.locked_plan_markdown !== '先配方，再用平方项非负。'
      || retainedAttempt.final_answer_markdown !== '$g(x)=(x-3)^2-4$，所以最小值为 $-4$。'
      || firstCleanup.imageRetention !== 'deleted'
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
    const privatePath = await storage.write(Buffer.from([137, 80, 78, 71, 1, 2, 3]), 'image/png');
    const privateMedia = await database.insertInto('media').values({
      expires_at: new Date('2026-09-21T12:00:00.000Z'),
      height: 800,
      mime: 'image/png',
      private_path: privatePath,
      purpose: 'handwriting',
      session_id: root.id,
      user_id: userId,
      width: 1200,
    }).executeTakeFirstOrThrow();
    const privateMediaId = String(privateMedia.insertId);
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
    const remainingPrivateMedia = await database.selectFrom('media').select('id')
      .where('id', '=', privateMediaId).executeTakeFirst();
    const privateBytesRemoved = await storage.read(privatePath).then(
      () => false,
      () => true,
    );
    if (
      deleted.deletedSessionCount !== 3
      || deleted.deletedMediaCount !== 1
      || deleted.pendingMediaDeletionCount !== 0
      || remainingLinkedSessions.length
      || remainingPrivateMedia
      || !privateBytesRemoved
    ) {
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

    const deferredSession = await createSession('主动删除·媒体重试验收');
    const deferredPath = await storage.write(Buffer.from([137, 80, 78, 71, 4, 5, 6]), 'image/png');
    const deferredMedia = await database.insertInto('media').values({
      expires_at: new Date('2026-09-21T12:00:00.000Z'),
      height: 600,
      mime: 'image/png',
      private_path: deferredPath,
      purpose: 'handwriting',
      session_id: deferredSession.id,
      user_id: userId,
      width: 900,
    }).executeTakeFirstOrThrow();
    const deferredMediaId = String(deferredMedia.insertId);
    const failedStorage = {
      remove: async () => { throw new Error('simulated storage outage'); },
    } as unknown as PrivateMediaStorageService;
    const deferredDeletion = await new DeleteService(databaseService, failedStorage)
      .deleteSession(userId, deferredSession.id);
    const pendingMedia = await database.selectFrom('media')
      .select(['expires_at', 'session_id'])
      .where('id', '=', deferredMediaId)
      .executeTakeFirstOrThrow();
    const pendingBytesStillRecoverable = await storage.read(deferredPath).then(
      () => true,
      () => false,
    );
    if (
      deferredDeletion.deletedMediaCount !== 0
      || deferredDeletion.pendingMediaDeletionCount !== 1
      || pendingMedia.session_id !== null
      || pendingMedia.expires_at.getTime() > Date.now() + 1_000
      || !pendingBytesStillRecoverable
    ) {
      throw new Error(`failed media deletion did not retain a retryable cleanup record: ${JSON.stringify({
        deletedMediaCount: deferredDeletion.deletedMediaCount,
        expiresAt: pendingMedia.expires_at,
        now: new Date(),
        pendingBytesStillRecoverable,
        pendingMediaDeletionCount: deferredDeletion.pendingMediaDeletionCount,
        sessionId: pendingMedia.session_id,
      })}`);
    }
    const retryCleanup = await runRetentionCleanup(
      database,
      new Date(Date.now() + 2_000),
      storage,
    );
    const retriedMedia = await database.selectFrom('media').select('id')
      .where('id', '=', deferredMediaId).executeTakeFirst();
    const retriedBytesRemoved = await storage.read(deferredPath).then(
      () => false,
      () => true,
    );
    if (retryCleanup.imageBytesDeleted !== 1 || retriedMedia || !retriedBytesRemoved) {
      throw new Error('retention cleanup did not retry deferred private media deletion');
    }

    const afterDeletionSession = await createSession('历史不完整后检验');
    await markOriginalCorrect(afterDeletionSession.id);
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
      'privacy retention passed: draftsCleared=2, lockedAndFinalPreserved=true, privateMediaRetentionActive=true, expiredCascade=true, linkedDeleteCount=3, linkedMediaDeleted=1, deferredMediaRetry=true, lateCommitRejected=true, historyIncomplete=true, futureFirstSeenEligible=false, questionBankUnaffected=true',
    );
  } finally {
    if (userId) await database.deleteFrom('users').where('id', '=', userId).execute();
    if (paperQuestionId) await database.deleteFrom('paper_question').where('id', '=', paperQuestionId).execute();
    if (questionId) await database.deleteFrom('question').where('id', '=', questionId).execute();
    if (paperId) await database.deleteFrom('paper').where('id', '=', paperId).execute();
    await database.destroy();
    await rm(storageRoot, { force: true, recursive: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Privacy retention verification failed');
  process.exitCode = 1;
});
