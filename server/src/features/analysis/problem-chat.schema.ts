import { z } from 'zod';

export const problemChatMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
    role: z.enum(['student', 'guide']),
  })
  .strict();

export const problemChatRequestSchema = z
  .object({
    assistanceMode: z.enum(['attempt', 'hint', 'explain', 'worked_solution', 'finish_problem']),
    expectedVersion: z.number().int().positive(),
    history: z.array(problemChatMessageSchema).max(16),
    message: z.string().trim().min(1).max(4_000),
    problemMd: z.string().trim().min(1).max(12_000),
    remediationFocus: z.enum(['method', 'execution', 'evidence']).optional(),
    requestId: z.uuid(),
    sessionId: z.string().regex(/^[1-9]\d*$/),
    transcriptId: z.string().regex(/^[1-9]\d*$/).optional(),
    transcriptRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (Boolean(request.transcriptId) !== Boolean(request.transcriptRevision)) {
      context.addIssue({
        code: 'custom',
        message: 'transcriptId and transcriptRevision must be provided together',
        path: ['transcriptId'],
      });
    }
  });

export const problemChatResponseSchema = z
  .object({
    currentVerdict: z.enum(['correct', 'incorrect', 'unknown']).optional(),
    reply: z.string().trim().min(1).max(2_000),
    routeAttribution: z.enum(['student', 'coauthored']).optional(),
  })
  .strict();

export const problemChatGuardSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000),
    verdict: z.enum(['accept', 'reject']),
  })
  .strict();

export type ProblemChatRequest = z.infer<typeof problemChatRequestSchema>;
export type ProblemChatMessage = z.infer<typeof problemChatMessageSchema>;
export type ProblemChatResponse = z.infer<typeof problemChatResponseSchema>;
