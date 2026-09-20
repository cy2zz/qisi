import { describe, expect, it } from 'vitest';
import { finishAssessmentSchema, submitAssessmentPlanSchema } from './assessment.schema.js';

describe('assessment handwriting bindings', () => {
  it('requires transcript id and revision together', () => {
    expect(submitAssessmentPlanSchema.safeParse({
      expectedVersion: 1,
      noPlan: false,
      planMarkdown: '先配方。',
      transcriptId: '41',
    }).success).toBe(false);
    expect(finishAssessmentSchema.safeParse({
      answerMarkdown: '$x=1$',
      expectedVersion: 2,
      transcriptRevision: 3,
    }).success).toBe(false);
  });

  it('accepts a complete binding but rejects one for an unanswered plan', () => {
    expect(submitAssessmentPlanSchema.safeParse({
      expectedVersion: 1,
      noPlan: false,
      planMarkdown: '先配方。',
      transcriptId: '41',
      transcriptRevision: 2,
    }).success).toBe(true);
    expect(submitAssessmentPlanSchema.safeParse({
      expectedVersion: 1,
      noPlan: true,
      planMarkdown: '',
      transcriptId: '41',
      transcriptRevision: 2,
    }).success).toBe(false);
  });
});
