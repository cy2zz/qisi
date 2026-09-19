import { describe, expect, it, vi } from 'vitest';
import type { ModelPort } from '../../model/model.port.js';
import { QuestionImageRecognitionService } from './question-image-recognition.service.js';

const recognition = {
  answerMarkdown: '$x=2$',
  questionType: '函数与导数',
  stemMarkdown: '已知函数 $f(x)=x^2$，求极值。',
  uncertain: [],
};

describe('QuestionImageRecognitionService', () => {
  it('uses the vision role and only extracts content visible in the image', async () => {
    const model = { generate: vi.fn().mockResolvedValue({ parsed: recognition }) };
    const service = new QuestionImageRecognitionService(model as unknown as ModelPort);
    const image = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' as const };

    await expect(service.recognize(image)).resolves.toEqual(recognition);
    expect(model.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [image],
        role: 'vision',
        system: expect.stringContaining('不要解题'),
      }),
    );
  });

  it('rejects malformed vision output instead of sending it into teaching', async () => {
    const model = { generate: vi.fn().mockResolvedValue({ parsed: { stemMarkdown: '' } }) };
    const service = new QuestionImageRecognitionService(model as unknown as ModelPort);

    await expect(
      service.recognize({ bytes: new Uint8Array([1]), mime: 'image/png' }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
