import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

interface LinkedSessionEvent {
  eventType: string;
  payload: unknown;
  sessionId: string;
  subjectId: string;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function sourceSessionId(payload: unknown) {
  const parsed = parseJson(payload);
  if (!parsed || typeof parsed !== 'object' || !('sourceSessionId' in parsed)) return null;
  const value = (parsed as { sourceSessionId?: unknown }).sourceSessionId;
  return typeof value === 'string' ? value : null;
}

export function collectLinkedSessionIds(
  rootSessionId: string,
  events: readonly LinkedSessionEvent[],
) {
  const selected = new Set([rootSessionId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const event of events) {
      const isReassessment = event.eventType === 'assessment_reassessment_started'
        && selected.has(event.subjectId);
      const isAssessmentHelp = event.eventType === 'assessment_help_session_started'
        && selected.has(sourceSessionId(event.payload) ?? '');
      if ((isReassessment || isAssessmentHelp) && !selected.has(event.sessionId)) {
        selected.add(event.sessionId);
        changed = true;
      }
    }
  }

  return [...selected];
}

@Injectable()
export class DeleteService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async deleteSession(ownerId: string, rootSessionId: string) {
    return this.database.client.transaction().execute(async (transaction) => {
      const root = await transaction
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', rootSessionId)
        .where('user_id', '=', ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (!root) throw new NotFoundException('learning session not found');

      const eventRows = await transaction
        .selectFrom('events as event')
        .innerJoin('sessions as session', 'session.id', 'event.session_id')
        .select([
          'event.event_type',
          'event.payload_json',
          'event.session_id',
          'event.subject_id',
        ])
        .where('session.user_id', '=', ownerId)
        .where('event.event_type', 'in', [
          'assessment_reassessment_started',
          'assessment_help_session_started',
        ])
        .execute();
      const sessionIds = collectLinkedSessionIds(
        rootSessionId,
        eventRows.map((event) => ({
          eventType: event.event_type,
          payload: event.payload_json,
          sessionId: String(event.session_id),
          subjectId: event.subject_id,
        })),
      );

      await transaction
        .selectFrom('sessions')
        .select('id')
        .where('id', 'in', sessionIds)
        .where('user_id', '=', ownerId)
        .forUpdate()
        .execute();
      await transaction
        .insertInto('owner_privacy_state')
        .values({ history_incomplete: 1, user_id: ownerId })
        .onDuplicateKeyUpdate({ history_incomplete: 1 })
        .execute();
      await transaction
        .updateTable('runs')
        .set({ status: 'cancelled' })
        .where('session_id', 'in', sessionIds)
        .where('user_id', '=', ownerId)
        .where('status', '=', 'active')
        .execute();
      await transaction
        .updateTable('requests')
        .set({
          error_json: JSON.stringify({ code: 'SESSION_DELETED' }),
          status: 'cancelled',
        })
        .where('session_id', 'in', sessionIds)
        .where('user_id', '=', ownerId)
        .where('status', '=', 'in_progress')
        .execute();
      const deleted = await transaction
        .deleteFrom('sessions')
        .where('id', 'in', sessionIds)
        .where('user_id', '=', ownerId)
        .executeTakeFirst();

      return {
        deleted: true as const,
        deletedSessionCount: Number(deleted.numDeletedRows),
        historyIncomplete: true as const,
      };
    });
  }
}
