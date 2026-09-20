import { describe, expect, it } from 'vitest';
import { problemChatRequestSchema } from './problem-chat.schema.js';

const validRequest = {
  assistanceMode: 'attempt',
  expectedVersion: 1,
  history: [],
  message: '我卡在展开后的符号。',
  problemMd: '求函数的单调区间。',
  requestId: '11111111-1111-4111-8111-111111111111',
  sessionId: '91',
};

describe('problemChatRequestSchema remediation focus', () => {
  it.each(['method', 'execution', 'evidence'] as const)('accepts the controlled %s focus', (focus) => {
    expect(problemChatRequestSchema.safeParse({
      ...validRequest,
      remediationFocus: focus,
    }).success).toBe(true);
  });

  it('rejects an unknown remediation focus', () => {
    expect(problemChatRequestSchema.safeParse({
      ...validRequest,
      remediationFocus: 'give_answer',
    }).success).toBe(false);
  });
});
