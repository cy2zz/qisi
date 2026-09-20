import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConfirmTranscriptInput, TranscriptLine } from '../../contracts/domain.schema.js';
import { TranscriptDraftSchema, TranscriptLineSchema } from '../../contracts/domain.schema.js';
import { DatabaseService } from '../../database/database.service.js';
import { HandwritingRecognitionService } from './handwriting-recognition.service.js';
import {
  createTranscriptDraft,
  validateTranscriptConfirmation,
} from './handwriting-transcript.js';
import { PrivateMediaStorageService } from './private-media-storage.service.js';
import type { ValidatedQuestionImage } from './question-image-validation.js';

const PRIVATE_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

function parseLines(value: unknown): TranscriptLine[] {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  return TranscriptLineSchema.array().parse(raw);
}

function transcriptMarkdown(lines: TranscriptLine[]) {
  return lines.map((line) => line.text.trim()).filter(Boolean).join('\n\n');
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(HandwritingRecognitionService)
    private readonly handwriting: HandwritingRecognitionService,
    @Inject(PrivateMediaStorageService)
    private readonly storage: PrivateMediaStorageService,
  ) {}

  async transcribeHandwriting(
    ownerId: string,
    sessionId: string | null,
    image: ValidatedQuestionImage,
  ) {
    if (sessionId) await this.assertOwnedSession(ownerId, sessionId);
    const recognized = await this.handwriting.recognize(image);
    const relativePath = await this.storage.write(Buffer.from(image.bytes), image.mime);
    const expiresAt = new Date(Date.now() + PRIVATE_MEDIA_TTL_MS);
    try {
      return await this.database.client.transaction().execute(async (transaction) => {
        const insertedMedia = await transaction
          .insertInto('media')
          .values({
            expires_at: expiresAt,
            height: image.height,
            mime: image.mime,
            private_path: relativePath,
            purpose: 'handwriting',
            session_id: sessionId,
            user_id: ownerId,
            width: image.width,
          })
          .executeTakeFirstOrThrow();
        const mediaId = String(insertedMedia.insertId);
        const placeholderLines = recognized.lines.map((line) => ({
          ...line,
          explicitly_confirmed: false,
        }));
        const insertedTranscript = await transaction
          .insertInto('transcripts')
          .values({
            confirmed: 0,
            expires_at: expiresAt,
            lines_json: JSON.stringify(placeholderLines),
            media_id: mediaId,
            revision: 1,
            session_id: sessionId,
            user_id: ownerId,
          })
          .executeTakeFirstOrThrow();
        const transcriptId = String(insertedTranscript.insertId);
        return {
          image: { height: image.height, mediaId, url: `/api/media/${mediaId}`, width: image.width },
          transcript: createTranscriptDraft(mediaId, transcriptId, recognized.lines),
        };
      });
    } catch (error) {
      await this.storage.remove(relativePath);
      throw error;
    }
  }

  async confirmTranscript(ownerId: string, transcriptId: string, input: ConfirmTranscriptInput) {
    return this.database.client.transaction().execute(async (transaction) => {
      const row = await transaction
        .selectFrom('transcripts')
        .select(['confirmed', 'id', 'lines_json', 'media_id', 'revision'])
        .where('id', '=', transcriptId)
        .where('user_id', '=', ownerId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.media_id === null) throw new NotFoundException('transcript not found');
      const previous = TranscriptDraftSchema.parse({
        confirmed: row.confirmed === 1,
        id: String(row.id),
        lines: parseLines(row.lines_json),
        media_id: String(row.media_id),
        revision: row.revision,
      });

      if (previous.confirmed) {
        const samePayload = input.expected_revision === previous.revision - 1
          && JSON.stringify(input.lines) === JSON.stringify(previous.lines);
        if (samePayload) return previous;
        throw new ConflictException('transcript is already confirmed');
      }
      const confirmed = validateTranscriptConfirmation(previous, input);
      await transaction
        .updateTable('transcripts')
        .set({
          confirmed: 1,
          lines_json: JSON.stringify(confirmed.lines),
          revision: confirmed.revision,
        })
        .where('id', '=', transcriptId)
        .where('revision', '=', previous.revision)
        .executeTakeFirstOrThrow();
      return confirmed;
    });
  }

  async readOwnedMedia(ownerId: string, mediaId: string) {
    const row = await this.database.client
      .selectFrom('media')
      .select(['mime', 'private_path'])
      .where('id', '=', mediaId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!row) throw new NotFoundException('media not found');
    return { bytes: await this.storage.read(row.private_path), mime: row.mime };
  }

  async assertConfirmedTranscript(
    ownerId: string,
    transcriptId: string,
    revision: number,
    markdown: string,
  ) {
    const row = await this.database.client
      .selectFrom('transcripts')
      .select(['confirmed', 'lines_json', 'revision'])
      .where('id', '=', transcriptId)
      .where('user_id', '=', ownerId)
      .executeTakeFirst();
    if (!row || row.confirmed !== 1) throw new ConflictException('handwriting is not confirmed');
    if (row.revision !== revision) throw new ConflictException('handwriting revision is stale');
    if (transcriptMarkdown(parseLines(row.lines_json)) !== markdown.trim()) {
      throw new ConflictException('handwriting text changed after confirmation');
    }
  }

  private async assertOwnedSession(ownerId: string, sessionId: string) {
    const session = await this.database.client
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .executeTakeFirst();
    if (!session) throw new NotFoundException('session not found');
  }
}
