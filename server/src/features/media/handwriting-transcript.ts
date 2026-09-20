import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import {
  ConfirmTranscriptInputSchema,
  TranscriptDraftSchema,
  type ConfirmTranscriptInput,
  type TranscriptDraft,
  type TranscriptLine,
} from '../../contracts/domain.schema.js';

const visionTranscriptLineSchema = z.strictObject({
  index: z.int().min(1),
  text: z.string().max(12_000),
  uncertain: z.boolean(),
});

export const visionTranscriptSchema = z.strictObject({
  lines: z.array(visionTranscriptLineSchema).min(1).max(200),
}).superRefine(({ lines }, context) => {
  let totalLength = 0;
  for (const [position, line] of lines.entries()) {
    if (line.index !== position + 1) {
      context.addIssue({
        code: 'custom',
        message: 'line indexes must be consecutive and start at 1',
        path: ['lines', position, 'index'],
      });
    }
    totalLength += line.text.length;
  }
  if (totalLength > 12_000) {
    context.addIssue({
      code: 'custom',
      message: 'transcript text exceeds 12000 characters',
      path: ['lines'],
    });
  }
});

export type VisionTranscript = z.infer<typeof visionTranscriptSchema>;

export function createTranscriptDraft(
  mediaId: string,
  transcriptId: string,
  lines: VisionTranscript['lines'],
): TranscriptDraft {
  return TranscriptDraftSchema.parse({
    confirmed: false,
    id: transcriptId,
    lines: lines.map((line) => ({
      ...line,
      explicitly_confirmed: false,
    })),
    media_id: mediaId,
    revision: 1,
  });
}

export function validateTranscriptConfirmation(
  previous: TranscriptDraft,
  candidate: ConfirmTranscriptInput,
): TranscriptDraft {
  const input = ConfirmTranscriptInputSchema.parse(candidate);
  if (input.transcript_id !== previous.id) {
    throw new BadRequestException('transcript id does not match');
  }
  if (input.expected_revision !== previous.revision) {
    throw new ConflictException('transcript revision is stale');
  }
  if (input.lines.length !== previous.lines.length) {
    throw new BadRequestException('transcript line count cannot change');
  }

  const lines: TranscriptLine[] = input.lines.map((line, position) => {
    const original = previous.lines[position];
    if (!original || line.index !== original.index || line.uncertain !== original.uncertain) {
      throw new BadRequestException('transcript line structure cannot change');
    }
    if (original.uncertain && !line.explicitly_confirmed) {
      throw new BadRequestException(`第 ${original.index} 行仍需明确确认`);
    }
    return line;
  });
  if (!lines.some((line) => line.text.trim())) {
    throw new BadRequestException('transcript cannot be empty');
  }

  return TranscriptDraftSchema.parse({
    ...previous,
    confirmed: true,
    lines,
    revision: previous.revision + 1,
  });
}
