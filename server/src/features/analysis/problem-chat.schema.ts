import { z } from 'zod';

export const problemChatMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
    role: z.enum(['student', 'guide']),
  })
  .strict();

export const problemChatRequestSchema = z
  .object({
    history: z.array(problemChatMessageSchema).max(16),
    message: z.string().trim().min(1).max(4_000),
    problemMd: z.string().trim().min(1).max(12_000),
  })
  .strict();

export const problemChatResponseSchema = z
  .object({
    reply: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type ProblemChatRequest = z.infer<typeof problemChatRequestSchema>;
export type ProblemChatResponse = z.infer<typeof problemChatResponseSchema>;
