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
      packetVersion: 'a'.repeat(64),
      preparationStatus: 'ready',
      problemMd: '化简 $\\frac{\\sqrt{2}}{\\sqrt{3}}$。',
      topic: '测试',
    });
    const requestId = randomUUID();
    await sessions.updateRemediationTrack(ownerId, session.id, 'execution');
    const restoredRemediation = await sessions.getSession(ownerId, session.id);
    if (restoredRemediation.remediationFocus !== 'execution') {
      throw new Error('remediation track was not restored before the next turn');
    }
    let remediationOwnerIsolationPassed = false;
    try {
      await sessions.updateRemediationTrack(otherOwnerId, session.id, 'method');
    } catch {
      remediationOwnerIsolationPassed = true;
    }
    if (!remediationOwnerIsolationPassed) {
      throw new Error('another user could change the remediation track');
    }
    const input = {
      assistanceMode: 'hint' as const,
      expectedVersion: session.version,
      message: '我需要提示',
      ownerId,
      remediationFocus: 'execution' as const,
      requestId,
      sessionId: session.id,
    };
    await sessions.saveDraft(ownerId, session.id, input.message);
    const restoredDraft = await sessions.getSession(ownerId, session.id);
    if (restoredDraft.draftMarkdown !== input.message) {
      throw new Error('learning draft was not restored before submission');
    }
    let draftOwnerIsolationPassed = false;
    try {
      await sessions.saveDraft(otherOwnerId, session.id, '不应写入');
    } catch {
      draftOwnerIsolationPassed = true;
    }
    if (!draftOwnerIsolationPassed) {
      throw new Error('another user could overwrite the learning draft');
    }
    const reservation = await sessions.reserveTurn(input);
    if (reservation.kind !== 'reserved') throw new Error('new request unexpectedly replayed');
    if (reservation.packetVersion !== 'a'.repeat(64)) {
      throw new Error('bound preparation packet was not restored for the tutor turn');
    }

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
        probe: {
          branches: [
            {
              counter_evidence: '能说明相关条件',
              expected: '遗漏关键条件',
              hypothesis_id: 'hypothesis-1',
              next_action: '回到条件核对',
            },
            {
              counter_evidence: '仍无法定位条件',
              expected: '条件理解无误',
              hypothesis_id: 'hypothesis-2',
              next_action: '检查表示转换',
            },
          ],
          goal_key: `session-${session.id}:method`,
          question_md: '哪一项条件直接支持你的下一步？',
        },
        probeGoalKey: `session-${session.id}:method`,
        scaffoldLevel: 1,
        wholeTaskDisclosed: false,
      },
      expectedVersion: reservation.expectedVersion,
      leaseToken: reservation.leaseToken,
      message: input.message,
      ownerId,
      remediationFocus: input.remediationFocus,
      reply: '先看条件。',
      requestId,
      runId: reservation.runId,
      sessionId: session.id,
    });
    const replay = await sessions.reserveTurn(input);
    if (replay.kind !== 'replay' || replay.reply !== committed.reply) {
      throw new Error('committed request did not replay the same safe response');
    }
    const afterSubmittedDraft = await sessions.getSession(ownerId, session.id);
    if (afterSubmittedDraft.draftMarkdown !== '') {
      throw new Error('submitted learning draft was not cleared transactionally');
    }
    await sessions.saveDraft(ownerId, session.id, '下一步还没发送的草稿');
    const finishInput = {
      ...input,
      assistanceMode: 'finish_problem' as const,
      expectedVersion: committed.version,
      message: '最终答案是 $2/3$。',
      requestId: randomUUID(),
    };
    const nextReservation = await sessions.reserveTurn(finishInput);
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
    const checked = await sessions.commitTurn({
      assistanceMode: finishInput.assistanceMode,
      currentVerdict: 'incorrect',
      expectedVersion: nextReservation.expectedVersion,
      leaseToken: nextReservation.leaseToken,
      message: finishInput.message,
      ownerId,
      remediationFocus: finishInput.remediationFocus,
      reply: '这次结论需要修正。',
      requestId: finishInput.requestId,
      runId: nextReservation.runId,
      sessionId: session.id,
    });
    const checkedReplay = await sessions.reserveTurn(finishInput);
    if (
      checkedReplay.kind !== 'replay'
      || checkedReplay.currentVerdict !== 'incorrect'
      || checkedReplay.reply !== checked.reply
    ) {
      throw new Error('checked verdict was not preserved in the safe replay');
    }
    const remediationAfterIncorrect = await sessions.getSession(ownerId, session.id);
    if (remediationAfterIncorrect.remediationFocus !== 'execution') {
      throw new Error('incorrect final check unexpectedly closed the remediation track');
    }
    await sessions.updateRemediationTrack(ownerId, session.id, null);
    const restored = await sessions.getSession(ownerId, session.id);
    if (restored.remediationFocus !== null) {
      throw new Error('explicit remediation exit was not restored');
    }
    const exposureEvents = await database
      .selectFrom('events')
      .select('event_type')
      .where('session_id', '=', session.id)
      .where('event_type', '=', 'help_exposed')
      .execute();
    const probeEvents = await database
      .selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', session.id)
      .where('event_type', '=', 'diagnostic_probe_shown')
      .execute();
    const answerCheckedEvents = await database
      .selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', session.id)
      .where('event_type', '=', 'current_answer_checked')
      .execute();
    const remediationEvents = await database
      .selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', session.id)
      .where('event_type', '=', 'remediation_track_updated')
      .orderBy('seq', 'asc')
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
    if (restored.record.version !== 3 || restored.messages.length !== 5) {
      throw new Error('restored session does not contain the committed turn');
    }
    if (restored.draftMarkdown !== '下一步还没发送的草稿') {
      throw new Error('new unsent learning draft did not survive later committed turns');
    }
    const restoredCheckedMessage = restored.messages.find(
      (message) => message.assistanceMode === 'finish_problem' && message.role === 'guide',
    );
    const restoredCheckedMetadata = restoredCheckedMessage?.metadata as {
      currentVerdict?: unknown;
      remediationFocus?: unknown;
    } | undefined;
    if (
      !restoredCheckedMessage
      || restoredCheckedMetadata?.currentVerdict !== 'incorrect'
      || restoredCheckedMetadata.remediationFocus !== 'execution'
      || !JSON.stringify(answerCheckedEvents[0]?.payload_json).includes('incorrect')
    ) {
      throw new Error('checked verdict was not restored with the guide message and event');
    }
    if (restored.record.title !== '二次根式化简题') {
      throw new Error(`formula problem title was not normalized: ${restored.record.title}`);
    }
    if (restored.record.preparationStatus !== 'ready') {
      throw new Error('safe preparation status was not restored for the student view');
    }
    if (exposureEvents.length !== 1) {
      throw new Error('help exposure was not recorded exactly once');
    }
    const probePayloadRaw = probeEvents[0]?.payload_json;
    const probePayload = (typeof probePayloadRaw === 'string'
      ? JSON.parse(probePayloadRaw)
      : probePayloadRaw) as {
      branches?: unknown[];
      goalKey?: string;
      questionMd?: string;
    } | undefined;
    if (
      probeEvents.length !== 1
      || probePayload?.goalKey !== `session-${session.id}:method`
      || probePayload.branches?.length !== 2
      || !probePayload.questionMd
    ) {
      throw new Error('probe branches were not persisted before the next turn');
    }
    if (
      remediationEvents.length !== 4
      || !JSON.stringify(remediationEvents[0]?.payload_json).includes('execution')
      || !JSON.stringify(remediationEvents.at(-1)?.payload_json).includes('null')
    ) {
      throw new Error('remediation activation, turn inheritance, or explicit exit was not persisted');
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
      `learning persistence passed: version=${restored.record.version}, messages=${restored.messages.length}, nodes=${persistedNodes.length}, exposures=${exposureEvents.length}, probes=1, replay=true, verdictReplay=true, draftRestore=true, draftSubmitClear=true, draftOwnerIsolation=true, remediationRestore=true, remediationExit=true, remediationOwnerIsolation=true, ownerIsolation=true`,
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
