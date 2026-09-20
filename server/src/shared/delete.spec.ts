import { describe, expect, it } from 'vitest';
import { collectLinkedSessionIds } from './delete.js';

describe('linked private session deletion', () => {
  it('collects reassessment and assessment-help descendants without touching unrelated sessions', () => {
    const linked = collectLinkedSessionIds('10', [
      {
        eventType: 'assessment_reassessment_started',
        payload: { rootSessionId: '10' },
        sessionId: '11',
        subjectId: '10',
      },
      {
        eventType: 'assessment_help_session_started',
        payload: { sourceSessionId: '11' },
        sessionId: '12',
        subjectId: '501',
      },
      {
        eventType: 'assessment_help_session_started',
        payload: { sourceSessionId: '99' },
        sessionId: '100',
        subjectId: '999',
      },
    ]);

    expect(linked).toEqual(['10', '11', '12']);
  });
});
