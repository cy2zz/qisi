import 'reflect-metadata';
import { config as loadEnvironmentFile } from 'dotenv';
import { randomBytes, randomUUID } from 'node:crypto';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import { LearningSessionService } from '../src/features/learning/learning-session.service.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const database = createDatabase(parseEnvironment(process.env));
  const createdUserIds: string[] = [];

  try {
    async function createTestUser(label: string) {
      const suffix = `${Date.now()}-${randomUUID()}`;
      const inserted = await database
        .insertInto('users')
        .values({
          username: label,
          username_normalized: `persistence-${suffix}`,
          cookie_token_hash: randomBytes(32),
        })
        .executeTakeFirstOrThrow();
      const id = String(inserted.insertId);
      createdUserIds.push(id);
      return id;
    }

    const ownerId = await createTestUser('持久化集成验证');
    const otherOwnerId = await createTestUser('归属隔离验证');
    const sessions = new LearningSessionService({ client: database } as never);
    const session = await sessions.createSession({
      analysis: {
        firstQuestion: '先做什么？',
        keyConditions: ['条件'],
        knowledgePoints: ['测试'],
        overview: '这是一道二次根式化简题。',
        target: '验证提交',
      },
      content: '化简 $\\frac{\\sqrt{2}}{\\sqrt{3}}$。',
      ownerId,
      problemMd: '化简 $\\frac{\\sqrt{2}}{\\sqrt{3}}$。',
      topic: '测试',
    });
    const requestId = randomUUID();
    const input = {
      assistanceMode: 'hint' as const,
      expectedVersion: session.version,
      message: '我需要提示',
      ownerId,
      requestId,
      sessionId: session.id,
    };
    const reservation = await sessions.reserveTurn(input);
    if (reservation.kind !== 'reserved') throw new Error('new request unexpectedly replayed');

    await sessions.recordTurnNode({
      finishedAt: new Date().toISOString(),
      inputHash: 'ab'.repeat(32),
      leaseToken: reservation.leaseToken,
      modelId: 'fixture-model',
      nodeKey: 'diagnosis',
      output: { judgment: 'unknown' },
      ownerId,
      promptVersion: 'prompt-v3.0',
      runId: reservation.runId,
      startedAt: new Date().toISOString(),
      status: 'completed',
      usage: {
        elapsedMs: 12,
        input: 20,
        kind: 'reported',
        output: 10,
        provider: 'fixture',
      },
    });

    const committed = await sessions.commitTurn({
      assistanceMode: input.assistanceMode,
      audit: {
        decisionIds: [`session-${session.id}:conditions`],
        focusGoalKey: `session-${session.id}:method`,
        intervention: 'condition_check',
        probeGoalKey: `session-${session.id}:method`,
        scaffoldLevel: 1,
        wholeTaskDisclosed: false,
      },
      expectedVersion: reservation.expectedVersion,
      leaseToken: reservation.leaseToken,
      message: input.message,
      ownerId,
      reply: '先看条件。',
      requestId,
      runId: reservation.runId,
      sessionId: session.id,
    });
    const replay = await sessions.reserveTurn(input);
    if (replay.kind !== 'replay' || replay.reply !== committed.reply) {
      throw new Error('committed request did not replay the same safe response');
    }
    const nextReservation = await sessions.reserveTurn({
      ...input,
      expectedVersion: committed.version,
      requestId: randomUUID(),
    });
    if (nextReservation.kind !== 'reserved') {
      throw new Error('next request unexpectedly replayed');
    }
    if (
      nextReservation.teachingState.exposures.length !== 1
      || nextReservation.teachingState.exposures[0]?.decision_ids[0]
        !== `session-${session.id}:conditions`
      || nextReservation.teachingState.probesShownByGoal[`session-${session.id}:method`] !== 1
    ) {
      throw new Error('irreversible exposure or probe state was not restored for the next turn');
    }
    const restored = await sessions.getSession(ownerId, session.id);
    const exposureEvents = await database
      .selectFrom('events')
      .select('event_type')
      .where('session_id', '=', session.id)
      .where('event_type', '=', 'help_exposed')
      .execute();
    const persistedNodes = await database
      .selectFrom('node_runs')
      .select(['model_id', 'node_key', 'prompt_version', 'status', 'usage_json'])
      .where('run_id', '=', reservation.runId)
      .execute();

    let ownerIsolationPassed = false;
    try {
      await sessions.getSession(otherOwnerId, session.id);
    } catch {
      ownerIsolationPassed = true;
    }
    if (!ownerIsolationPassed) throw new Error('another user could read the learning session');
    if (restored.record.version !== 2 || restored.messages.length !== 3) {
      throw new Error('restored session does not contain the committed turn');
    }
    if (restored.record.title !== '二次根式化简题') {
      throw new Error(`formula problem title was not normalized: ${restored.record.title}`);
    }
    if (exposureEvents.length !== 1) {
      throw new Error('help exposure was not recorded exactly once');
    }
    if (
      persistedNodes.length !== 1
      || persistedNodes[0]?.node_key !== 'diagnosis'
      || persistedNodes[0]?.model_id !== 'fixture-model'
      || persistedNodes[0]?.prompt_version !== 'prompt-v3.0'
      || persistedNodes[0]?.status !== 'completed'
      || !persistedNodes[0]?.usage_json
    ) {
      throw new Error('checked tutor node metadata was not persisted');
    }

    console.info(
      `learning persistence passed: version=${restored.record.version}, messages=${restored.messages.length}, nodes=${persistedNodes.length}, exposures=${exposureEvents.length}, probes=1, replay=true, ownerIsolation=true`,
    );
  } finally {
    for (const userId of createdUserIds) {
      await database.deleteFrom('users').where('id', '=', userId).execute();
    }
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Learning persistence verification failed');
  process.exitCode = 1;
});
