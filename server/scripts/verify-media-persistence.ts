import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { config as loadEnvironmentFile } from 'dotenv';
import { environmentFilePaths, parseEnvironment, type AppEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { HandwritingRecognitionService } from '../src/features/media/handwriting-recognition.service.js';
import { MediaService } from '../src/features/media/media.service.js';
import { PrivateMediaStorageService } from '../src/features/media/private-media-storage.service.js';
import { LearningSessionService } from '../src/features/learning/learning-session.service.js';
import { runRetentionCleanup } from '../src/shared/retention.js';

function parseJson(value: unknown) {
  return typeof value === 'string' ? JSON.parse(value) as unknown : value;
}

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const database = createDatabase(parseEnvironment(process.env));
  const databaseService = { client: database } as DatabaseService;
  const createdUserIds: string[] = [];
  const storageRoot = await mkdtemp(join(tmpdir(), 'qisi-media-persistence-'));

  try {
    async function createTestUser(label: string) {
      const suffix = `${Date.now()}-${randomUUID()}`;
      const inserted = await database.insertInto('users').values({
        cookie_token_hash: randomBytes(32),
        username: label,
        username_normalized: `media-${suffix}`,
      }).executeTakeFirstOrThrow();
      const id = String(inserted.insertId);
      createdUserIds.push(id);
      return id;
    }

    const ownerId = await createTestUser('手写媒体持久化验证');
    const otherOwnerId = await createTestUser('手写媒体越权验证');
    const sessions = new LearningSessionService(databaseService);
    const session = await sessions.createSession({
      analysis: {
        firstQuestion: '移项后能否写成平方？',
        keyConditions: ['$a,b$ 为实数'],
        knowledgePoints: ['基本不等式'],
        overview: '这是一道不等式证明题。',
        target: '证明不等式恒成立。',
      },
      content: String.raw`证明 $a^2+b^2\geq 2ab$。`,
      ownerId,
      problemMd: String.raw`证明 $a^2+b^2\geq 2ab$。`,
      title: '手写媒体持久化验证',
      topic: '不等式',
    });
    const recognizedLines = [
      { index: 1, text: String.raw`$a^2-2ab+b^2$`, uncertain: false },
      { index: 2, text: String.raw`$=(a-b)^2\geq0$`, uncertain: true },
    ];
    const handwriting = {
      recognize: async () => ({ lines: recognizedLines }),
    } as unknown as HandwritingRecognitionService;
    const config = { get: () => storageRoot } as unknown as ConfigService<AppEnvironment, true>;
    const storage = new PrivateMediaStorageService(config);
    const media = new MediaService(databaseService, handwriting, storage);
    const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

    const created = await media.transcribeHandwriting(ownerId, session.id, {
      bytes: imageBytes,
      height: 800,
      mime: 'image/png',
      width: 1200,
    });
    const privateImage = await media.readOwnedMedia(ownerId, created.image.mediaId);
    if (!Buffer.from(privateImage.bytes).equals(Buffer.from(imageBytes))) {
      throw new Error('private handwriting bytes did not round-trip');
    }
    await media.readOwnedMedia(otherOwnerId, created.image.mediaId).then(
      () => { throw new Error('another user could read private handwriting media'); },
      () => undefined,
    );
    await media.confirmTranscript(otherOwnerId, created.transcript.id, {
      expected_revision: 1,
      lines: created.transcript.lines,
      request_id: randomUUID(),
      transcript_id: created.transcript.id,
    }).then(
      () => { throw new Error('another user could confirm the handwriting transcript'); },
      () => undefined,
    );

    const confirmationInput = {
      expected_revision: 1,
      lines: created.transcript.lines.map((line) => (
        line.uncertain ? { ...line, explicitly_confirmed: true } : line
      )),
      request_id: randomUUID(),
      transcript_id: created.transcript.id,
    };
    const confirmed = await media.confirmTranscript(ownerId, created.transcript.id, confirmationInput);
    const duplicate = await media.confirmTranscript(ownerId, created.transcript.id, confirmationInput);
    if (!confirmed.confirmed || confirmed.revision !== 2 || duplicate.revision !== 2) {
      throw new Error('confirmed transcript revision was not idempotent');
    }
    await media.confirmTranscript(ownerId, created.transcript.id, {
      ...confirmationInput,
      expected_revision: 2,
    }).then(
      () => { throw new Error('stale or changed confirmation unexpectedly succeeded'); },
      () => undefined,
    );

    const markdown = confirmed.lines.map((line) => line.text).join('\n\n');
    await media.assertConfirmedTranscript(ownerId, confirmed.id, confirmed.revision, markdown);
    await media.assertConfirmedTranscript(ownerId, confirmed.id, confirmed.revision, `${markdown}\nchanged`).then(
      () => { throw new Error('changed text retained confirmed handwriting provenance'); },
      () => undefined,
    );

    const requestId = randomUUID();
    const reservation = await sessions.reserveTurn({
      assistanceMode: 'attempt',
      expectedVersion: session.version,
      message: markdown,
      ownerId,
      requestId,
      sessionId: session.id,
      transcriptId: confirmed.id,
      transcriptRevision: confirmed.revision,
    });
    if (reservation.kind !== 'reserved') throw new Error('handwriting request unexpectedly replayed');
    await sessions.commitTurn({
      assistanceMode: 'attempt',
      expectedVersion: reservation.expectedVersion,
      leaseToken: reservation.leaseToken,
      message: markdown,
      ownerId,
      reply: '先说明这一步使用了完全平方。',
      requestId,
      runId: reservation.runId,
      sessionId: session.id,
      transcriptId: confirmed.id,
      transcriptRevision: confirmed.revision,
    });
    const studentMessage = await database.selectFrom('learning_messages')
      .select('metadata_json')
      .where('session_id', '=', session.id)
      .where('request_id', '=', requestId)
      .where('role', '=', 'student')
      .executeTakeFirstOrThrow();
    const submittedEvent = await database.selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', session.id)
      .where('subject_id', '=', requestId)
      .where('event_type', '=', 'student_submitted')
      .executeTakeFirstOrThrow();
    const actualMessageMetadata = parseJson(studentMessage.metadata_json) as Record<string, unknown>;
    const actualEventPayload = parseJson(submittedEvent.payload_json) as Record<string, unknown>;
    if (
      actualMessageMetadata.source !== 'handwriting'
      || actualMessageMetadata.transcriptId !== confirmed.id
      || actualMessageMetadata.transcriptRevision !== confirmed.revision
      || actualEventPayload.assistanceMode !== 'attempt'
      || actualEventPayload.source !== 'handwriting'
      || actualEventPayload.transcriptId !== confirmed.id
      || actualEventPayload.transcriptRevision !== confirmed.revision
    ) {
      throw new Error('confirmed handwriting provenance was not committed with the student submission');
    }

    const unconfirmed = await media.transcribeHandwriting(ownerId, session.id, {
      bytes: imageBytes,
      height: 800,
      mime: 'image/png',
      width: 1200,
    });
    const mediaRows = await database.selectFrom('media')
      .select(['id', 'private_path'])
      .where('id', 'in', [created.image.mediaId, unconfirmed.image.mediaId])
      .execute();
    const expiredAt = new Date('2026-09-19T00:00:00.000Z');
    await database.updateTable('media')
      .set({ expires_at: expiredAt })
      .where('id', 'in', [created.image.mediaId, unconfirmed.image.mediaId])
      .execute();
    await database.updateTable('transcripts')
      .set({ expires_at: expiredAt })
      .where('id', 'in', [confirmed.id, unconfirmed.transcript.id])
      .execute();
    const cleanup = await runRetentionCleanup(
      database,
      new Date('2026-09-20T00:00:00.000Z'),
      storage,
    );
    const retainedConfirmed = await database.selectFrom('transcripts')
      .select(['confirmed', 'media_id'])
      .where('id', '=', confirmed.id)
      .executeTakeFirst();
    const removedUnconfirmed = await database.selectFrom('transcripts')
      .select('id')
      .where('id', '=', unconfirmed.transcript.id)
      .executeTakeFirst();
    if (
      cleanup.imageBytesDeleted !== 2
      || cleanup.deletedTranscriptCount !== 1
      || retainedConfirmed?.confirmed !== 1
      || retainedConfirmed.media_id !== null
      || removedUnconfirmed
    ) {
      throw new Error('24-hour media retention did not preserve only the confirmed text evidence');
    }
    for (const mediaRow of mediaRows) {
      await storage.read(mediaRow.private_path).then(
        () => { throw new Error('expired private image bytes remained on disk'); },
        () => undefined,
      );
    }

    console.info(
      'media persistence passed: privateRoundTrip=true, ownerIsolation=true, confirmedRevision=2, duplicateConfirmIdempotent=true, staleRejected=true, changedTextRejected=true, submissionProvenance=true, image24hDeleted=2, unconfirmedTranscriptDeleted=1, confirmedTextRetained=true',
    );
  } finally {
    for (const userId of createdUserIds) {
      await database.deleteFrom('users').where('id', '=', userId).execute();
    }
    await database.destroy();
    await rm(storageRoot, { force: true, recursive: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Media persistence verification failed');
  process.exitCode = 1;
});
