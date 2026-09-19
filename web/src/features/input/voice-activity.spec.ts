import { describe, expect, it } from 'vitest';
import {
  containsAudibleVoice,
  REALTIME_SILENCE_TIMEOUT_MS,
  shouldStopForRealtimeSilence,
} from './voice-activity';

describe('realtime voice activity', () => {
  it('distinguishes silence from an audible PCM frame', () => {
    expect(containsAudibleVoice(new Int16Array(256))).toBe(false);
    expect(containsAudibleVoice(new Int16Array(256).fill(2_000))).toBe(true);
  });

  it('stops only after the realtime silence window has elapsed', () => {
    expect(shouldStopForRealtimeSilence(1_000, 1_000 + REALTIME_SILENCE_TIMEOUT_MS - 1)).toBe(false);
    expect(shouldStopForRealtimeSilence(1_000, 1_000 + REALTIME_SILENCE_TIMEOUT_MS)).toBe(true);
  });
});
