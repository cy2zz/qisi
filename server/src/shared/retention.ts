import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../database/database.types.js';
import { DatabaseService } from '../database/database.service.js';
import { collectLinkedSessionIds } from './delete.js';

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export function retentionCutoffs(now: Date) {
  return {
    draftBefore: new Date(now.getTime() - DRAFT_TTL_MS),
    sessionExpiresAtOrBefore: now,
  };
}

interface PrivateMediaRemover {
  remove(relativePath: string): Promise<void>;
}

export async function runRetentionCleanup(
  database: Kysely<Database>,
  now = new Date(),
  mediaStorage?: PrivateMediaRemover,
) {
  const cutoffs = retentionCutoffs(now);
  const expiredMedia = await database
    .selectFrom('media')
    .select(['id', 'private_path'])
    .where('expires_at', '<=', now)
    .execute();
  if (expiredMedia.length && !mediaStorage) {
    throw new Error('private media storage is required to delete expired image bytes');
  }
  await Promise.all(expiredMedia.map((media) => mediaStorage!.remove(media.private_path)));

  return database.transaction().execute(async (transaction) => {
    const drafts = await transaction
      .updateTable('check_attempts')
      .set({ answer_draft_markdown: '', plan_draft_markdown: '' })
      .where('db_update_time', '<=', cutoffs.draftBefore)
      .where((expression) => expression.or([
        expression('answer_draft_markdown', '!=', ''),
        expression('plan_draft_markdown', '!=', ''),
      ]))
      .executeTakeFirst();
    const learningDrafts = await transaction
      .deleteFrom('learning_drafts')
      .where('expires_at', '<=', now)
      .executeTakeFirst();
    const clearedDraftCount = Number(drafts.numUpdatedRows)
      + Number(learningDrafts.numDeletedRows);
    const expiredTranscripts = await transaction
      .deleteFrom('transcripts')
      .where('confirmed', '=', 0)
      .where('expires_at', '<=', now)
      .executeTakeFirst();
    const expiredMediaRows = expiredMedia.length
      ? await transaction
          .deleteFrom('media')
          .where('id', 'in', expiredMedia.map((media) => media.id))
          .where('expires_at', '<=', now)
          .executeTakeFirst()
      : null;
    const deletedTranscriptCount = Number(expiredTranscripts.numDeletedRows);
    const imageBytesDeleted = Number(expiredMediaRows?.numDeletedRows ?? 0);

    const expiredRows = await transaction
      .selectFrom('sessions')
      .select(['id', 'user_id'])
      .where('expires_at', '<=', cutoffs.sessionExpiresAtOrBefore)
      .execute();
    if (!expiredRows.length) {
      return {
        clearedDraftCount,
        deletedTranscriptCount,
        deletedSessionCount: 0,
        historyIncompleteOwnerCount: 0,
        imageBytesDeleted,
        imageRetention: 'deleted' as const,
      };
    }

    const ownerIds = [...new Set(expiredRows.map((row) => String(row.user_id)))];
    const allEventRows = await transaction
      .selectFrom('events as event')
      .innerJoin('sessions as session', 'session.id', 'event.session_id')
      .select([
        'event.event_type',
        'event.payload_json',
        'event.session_id',
        'event.subject_id',
      ])
      .where('session.user_id', 'in', ownerIds)
      .where('event.event_type', 'in', [
        'assessment_reassessment_started',
        'assessment_help_session_started',
      ])
      .execute();
    const events = allEventRows.map((event) => ({
      eventType: event.event_type,
      payload: event.payload_json,
      sessionId: String(event.session_id),
      subjectId: event.subject_id,
    }));
    const sessionIds = [...new Set(expiredRows.flatMap((row) =>
      collectLinkedSessionIds(String(row.id), events),
    ))];

    await transaction
      .selectFrom('sessions')
      .select('id')
      .where('id', 'in', sessionIds)
      .forUpdate()
      .execute();
    await transaction
      .insertInto('owner_privacy_state')
      .values(ownerIds.map((userId) => ({ history_incomplete: 1, user_id: userId })))
      .onDuplicateKeyUpdate({ history_incomplete: 1 })
      .execute();
    await transaction
      .updateTable('runs')
      .set({ status: 'cancelled' })
      .where('session_id', 'in', sessionIds)
      .where('status', '=', 'active')
      .execute();
    await transaction
      .updateTable('requests')
      .set({
        error_json: JSON.stringify({ code: 'SESSION_EXPIRED' }),
        status: 'cancelled',
      })
      .where('session_id', 'in', sessionIds)
      .where('status', '=', 'in_progress')
      .execute();
    const deleted = await transaction
      .deleteFrom('sessions')
      .where('id', 'in', sessionIds)
      .executeTakeFirst();

    return {
      clearedDraftCount,
      deletedTranscriptCount,
      deletedSessionCount: Number(deleted.numDeletedRows),
      historyIncompleteOwnerCount: ownerIds.length,
      imageBytesDeleted,
      imageRetention: 'deleted' as const,
    };
  });
}

@Injectable()
export class RetentionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  cleanup(now = new Date()) {
    return runRetentionCleanup(this.database.client, now);
  }
}
