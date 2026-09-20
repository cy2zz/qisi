import { afterEach, describe, expect, it, vi } from 'vitest';
import { recognizeQuestionImage, recognitionToMarkdown } from './image-question-client';

describe('question image client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uploads the original image bytes with its declared type', async () => {
    const result = {
      image: { height: 800, width: 1200 },
      recognition: {
        answerMarkdown: '$x=2$',
        questionType: '函数题',
        stemMarkdown: '已知 $f(x)=x^2$。',
        uncertain: [],
      },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    const file = new File(['image'], 'question.png', { type: 'image/png' });

    await expect(recognizeQuestionImage(file)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/media/recognize-question',
      expect.objectContaining({
        body: file,
        credentials: 'include',
        headers: expect.any(Headers),
        method: 'POST',
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('Content-Type')).toBe('image/png');
  });

  it('keeps a visible answer separate from the extracted stem', () => {
    expect(
      recognitionToMarkdown({
        answerMarkdown: '$x=2$',
        questionType: '函数题',
        stemMarkdown: '求方程的根。',
        uncertain: [],
      }),
    ).toBe('**题型：** 函数题\n\n求方程的根。\n\n**图片中可见答案或解答：**\n\n$x=2$');
  });
});
