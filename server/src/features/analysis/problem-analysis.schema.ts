import { z } from 'zod';

export const problemAnalysisSchema = z
  .object({
    firstQuestion: z.string().min(1).max(300),
    keyConditions: z.array(z.string().min(1).max(200)).max(8),
    knowledgePoints: z.array(z.string().min(1).max(80)).max(6),
    overview: z.string().min(1).max(500),
    target: z.string().min(1).max(300),
  })
  .strict();

export type ProblemAnalysis = z.infer<typeof problemAnalysisSchema>;
