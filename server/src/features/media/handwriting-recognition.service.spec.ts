import { describe, expect, it, vi } from 'vitest';
import type { ModelPort } from '../../model/model.port.js';
import { HandwritingRecognitionService } from './handwriting-recognition.service.js';

const image = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' as const };

describe('HandwritingRecognitionService', () => {
  it('asks vision to transcribe without correcting or judging the student work', async () => {
    const parsed = {
      lines: [
        { index: 1, text: String.raw`$a^2-2ab+b^2$`, uncertain: false },
        { index: 2, text: String.raw`$=(a-b)^2\geq 0$`, uncertain: true },
      ],
    };
    const model = { generate: vi.fn().mockResolvedValue({ parsed }) };
    const service = new HandwritingRecognitionService(model as unknown as ModelPort);

    await expect(service.recognize(image)).resolves.toEqual(parsed);
    expect(model.generate).toHaveBeenCalledWith(expect.objectContaining({
      images: [image],
      role: 'vision',
      system: expect.stringContaining('不要解题、纠错、补步骤、评价正误'),
    }));
  });

  it.each([
    {
      name: 'server-owned confirmation fields',
      parsed: {
        confirmed: true,
        lines: [{ explicitly_confirmed: true, index: 1, text: '$x=1$', uncertain: false }],
        revision: 9,
      },
    },
    {
      name: 'non-consecutive line indexes',
      parsed: { lines: [{ index: 2, text: '$x=1$', uncertain: false }] },
    },
    {
      name: 'more than 12000 transcript characters',
      parsed: { lines: [{ index: 1, text: 'x'.repeat(12_001), uncertain: false }] },
    },
  ])('rejects $name instead of trusting malformed model output', async ({ parsed }) => {
    const model = { generate: vi.fn().mockResolvedValue({ parsed }) };
    const service = new HandwritingRecognitionService(model as unknown as ModelPort);

    await expect(service.recognize(image)).rejects.toMatchObject({ status: 502 });
  });
});
