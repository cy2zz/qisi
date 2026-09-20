import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { config as loadEnvironmentFile } from 'dotenv';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { HistoryService } from '../src/features/history/history.service.js';
import { LearningSessionService } from '../src/features/learning/learning-session.service.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const database = createDatabase(parseEnvironment(process.env));
  const databaseService = { client: database } as DatabaseService;
  const history = new HistoryService(databaseService);
  const sessions = new LearningSessionService(databaseService);
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const userIds: string[] = [];

  try {
    for (const prefix of ['history-owner', 'history-other']) {
      const username = `${prefix}-${suffix}`;
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
    const analysis = {
      firstQuestion: '如何配方？',
      keyConditions: ['二次项系数为正'],
      knowledgePoints: ['配方法'],
      overview: '这是一道二次函数最值题。',
      target: '求出函数最小值',
    };
    const create = (userId: string, title: string) => sessions.createSession({
      analysis,
      content: '求 $f(x)=x^2-4x$ 的最小值。',
      ownerId: userId,
      problemMd: '求 $f(x)=x^2-4x$ 的最小值。',
      title,
      topic: '二次函数',
    });

    const source = await create(ownerId, '配方法原题');
    const finishRequestId = `history-finish-${suffix}`;
    const finish = await sessions.reserveTurn({
      assistanceMode: 'finish_problem',
      expectedVersion: source.version,
      message: '我配成 $(x-2)^2-4$，所以最小值为 $-4$。',
      ownerId,
      requestId: finishRequestId,
      sessionId: source.id,
    });
    if (finish.kind !== 'reserved') throw new Error('history finish unexpectedly replayed');
    await sessions.commitTurn({
      assistanceMode: 'finish_problem',
      currentVerdict: 'correct',
      expectedVersion: finish.expectedVersion,
      leaseToken: finish.leaseToken,
      message: '我配成 $(x-2)^2-4$，所以最小值为 $-4$。',
      ownerId,
      reply: '这次结论有依据。',
      requestId: finishRequestId,
      runId: finish.runId,
      sessionId: source.id,
    });

    const helpSession = await create(ownerId, '检验求助内部会话');
    await database.transaction().execute(async (transaction) => {
      await transaction.insertInto('events').values({
        dependency_ids_json: JSON.stringify([]),
        event_type: 'assessment_help_session_started',
        invalidated: 0,
        payload_json: JSON.stringify({ sourceSessionId: source.id }),
        seq: 1,
        session_id: helpSession.id,
        subject_id: '999999999',
      }).execute();
      await transaction.updateTable('sessions').set({ next_event_seq: 2 })
        .where('id', '=', helpSession.id).execute();
    });
    const helpRequestId = `history-help-${suffix}`;
    const help = await sessions.reserveTurn({
      assistanceMode: 'hint',
      expectedVersion: helpSession.version,
      message: '给我一点提示。',
      ownerId,
      requestId: helpRequestId,
      sessionId: helpSession.id,
    });
    if (help.kind !== 'reserved') throw new Error('history help unexpectedly replayed');
    await sessions.commitTurn({
      assistanceMode: 'hint',
      expectedVersion: help.expectedVersion,
      leaseToken: help.leaseToken,
      message: '给我一点提示。',
      ownerId,
      reply: '先观察一次项系数。',
      requestId: helpRequestId,
      runId: help.runId,
      sessionId: helpSession.id,
    });

    const other = await create(otherOwnerId, '其他用户的题目');
    const ownerHistory = await history.getHistory(ownerId);
    const otherHistory = await history.getHistory(otherOwnerId);
    const entry = ownerHistory.entries.find((item) => item.session_id === source.id);
    if (
      ownerHistory.entries.length !== 1
      || !entry
      || !entry.latest_student_work_markdown?.includes('最小值为')
      || entry.original_status !== 'completed_with_help'
      || !entry.help.exposed
      || !entry.help.modes.includes('hint')
      || ownerHistory.entries.some((item) => item.session_id === helpSession.id)
      || ownerHistory.entries.some((item) => item.session_id === other.id)
      || otherHistory.entries.length !== 1
      || otherHistory.entries[0]?.session_id !== other.id
    ) {
      throw new Error('history projection did not preserve evidence or owner isolation');
    }

    console.info(
      'history persistence passed: ownerSessions=1, internalHelpFolded=true, helpExposed=true, ownerIsolation=true, originalStatus=completed_with_help',
    );
  } finally {
    if (userIds.length) await database.deleteFrom('users').where('id', 'in', userIds).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'History persistence failed');
  process.exitCode = 1;
});
