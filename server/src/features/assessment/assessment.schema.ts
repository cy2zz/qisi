import { z } from 'zod';

export const assessmentTaskCandidateSchema = z
  .object({
    equivalenceGroup: z.string().min(1).max(128),
    promptMarkdown: z.string().min(1).max(12_000),
    referenceAnswerMarkdown: z.string().min(1).max(12_000),
    relation: z.enum(['near_transfer', 'near_duplicate']),
    rubric: z.array(z.string().min(1).max(500)).min(1).max(12),
  })
  .strict();

export const assessmentTaskVerificationSchema = z
  .object({
    reason: z.string().min(1).max(500),
    verdict: z.enum(['accept', 'reject']),
  })
  .strict();

const verdictSchema = z.enum(['correct', 'incorrect', 'unknown', 'unanswered']);

export const assessmentGradeSchema = z
  .object({
    evidence: z.array(z.string().min(1).max(500)).max(12),
    execution: verdictSchema,
    planning: verdictSchema,
    summary: z.string().min(1).max(1_000),
  })
  .strict();

export const assessmentGradeGuardSchema = z
  .object({
    reason: z.string().min(1).max(500),
    verdict: z.enum(['accept', 'reject']),
  })
  .strict();

export const saveAssessmentDraftSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    kind: z.enum(['plan', 'answer']),
    markdown: z.string().max(12_000),
  })
  .strict();

export const submitAssessmentPlanSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    noPlan: z.boolean(),
    planMarkdown: z.string().max(12_000),
    transcriptId: z.string().regex(/^[1-9]\d*$/).optional(),
    transcriptRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.noPlan && !value.planMarkdown.trim()) {
      context.addIssue({ code: 'custom', message: 'plan is required', path: ['planMarkdown'] });
    }
    if (Boolean(value.transcriptId) !== Boolean(value.transcriptRevision)) {
      context.addIssue({
        code: 'custom',
        message: 'transcriptId and transcriptRevision must be provided together',
        path: ['transcriptId'],
      });
    }
    if (value.noPlan && value.transcriptId) {
      context.addIssue({
        code: 'custom',
        message: 'an unanswered plan cannot have handwriting evidence',
        path: ['transcriptId'],
      });
    }
  });

export const finishAssessmentSchema = z
  .object({
    answerMarkdown: z.string().max(12_000),
    expectedVersion: z.number().int().positive(),
    transcriptId: z.string().regex(/^[1-9]\d*$/).optional(),
    transcriptRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.transcriptId) !== Boolean(value.transcriptRevision)) {
      context.addIssue({
        code: 'custom',
        message: 'transcriptId and transcriptRevision must be provided together',
        path: ['transcriptId'],
      });
    }
  });

export const requestAssessmentHelpSchema = z
  .object({
    currentMarkdown: z.string().max(12_000),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export type AssessmentGrade = z.infer<typeof assessmentGradeSchema>;
export type AssessmentTaskCandidate = z.infer<typeof assessmentTaskCandidateSchema>;
