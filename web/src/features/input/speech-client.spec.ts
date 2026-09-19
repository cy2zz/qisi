import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribeShortSpeech } from './speech-client';

describe('speech client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the formula-formatted draft from the speech API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      formulaFormatted: true,
      transcript: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
    }), { status: 200 })));

    await expect(transcribeShortSpeech(new Blob(['wav']))).resolves.toEqual({
      formulaFormatted: true,
      transcript: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
    });
  });
});
