import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  createTranscriptDraft,
  validateTranscriptConfirmation,
  visionTranscriptSchema,
} from './handwriting-transcript.js';

describe('handwriting transcript domain', () => {
  it('projects only model-owned line fields into an unconfirmed server draft', () => {
    const vision = visionTranscriptSchema.parse({
      lines: [
        { index: 1, text: String.raw`$1+\frac{1}{x^2}$`, uncertain: false },
        { index: 2, text: String.raw`$x\geq -1$`, uncertain: true },
      ],
    });

    expect(createTranscriptDraft('31', '41', vision.lines)).toEqual({
      confirmed: false,
      id: '41',
      lines: [
        { explicitly_confirmed: false, index: 1, text: String.raw`$1+\frac{1}{x^2}$`, uncertain: false },
        { explicitly_confirmed: false, index: 2, text: String.raw`$x\geq -1$`, uncertain: true },
      ],
      media_id: '31',
      revision: 1,
    });
  });

  it('requires every uncertain line to be explicitly confirmed or corrected', () => {
    const previous = createTranscriptDraft('31', '41', [
      { index: 1, text: String.raw`$1+\frac{1}{x^2}$`, uncertain: false },
      { index: 2, text: String.raw`$x\geq -1$`, uncertain: true },
    ]);

    expect(() => validateTranscriptConfirmation(previous, {
      expected_revision: 1,
      lines: previous.lines,
      request_id: '7cd1cc14-35b3-4e73-8c0a-ad9223330ad8',
      transcript_id: '41',
    })).toThrow(BadRequestException);

    const confirmed = validateTranscriptConfirmation(previous, {
      expected_revision: 1,
      lines: previous.lines.map((line) => (
        line.index === 2 ? { ...line, explicitly_confirmed: true } : line
      )),
      request_id: '7cd1cc14-35b3-4e73-8c0a-ad9223330ad8',
      transcript_id: '41',
    });

    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.revision).toBe(2);
  });

  it('rejects stale or structurally changed confirmation payloads', () => {
    const previous = createTranscriptDraft('31', '41', [
      { index: 1, text: '第一行', uncertain: false },
      { index: 2, text: '第二行', uncertain: false },
    ]);

    expect(() => validateTranscriptConfirmation(previous, {
      expected_revision: 2,
      lines: previous.lines,
      request_id: '7cd1cc14-35b3-4e73-8c0a-ad9223330ad8',
      transcript_id: '41',
    })).toThrow(ConflictException);

    expect(() => validateTranscriptConfirmation(previous, {
      expected_revision: 1,
      lines: [previous.lines[1]],
      request_id: '7cd1cc14-35b3-4e73-8c0a-ad9223330ad8',
      transcript_id: '41',
    })).toThrow(BadRequestException);
  });
});
