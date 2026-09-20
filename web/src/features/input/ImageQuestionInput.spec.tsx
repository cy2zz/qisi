import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageQuestionInput, type ImageQuestionInputHandle } from './ImageQuestionInput';
import { recognizeQuestionImage } from './image-question-client';

vi.mock('./image-question-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./image-question-client')>();
  return { ...actual, recognizeQuestionImage: vi.fn() };
});

describe('ImageQuestionInput', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('recognizes a selected image and auto-submits a certain extraction', async () => {
    vi.mocked(recognizeQuestionImage).mockResolvedValue({
      image: { height: 800, width: 1200 },
      recognition: {
        answerMarkdown: null,
        questionType: '解析几何',
        stemMarkdown: '已知椭圆 $C$。',
        uncertain: [],
      },
    });
    const ref = createRef<ImageQuestionInputHandle>();
    const onRecognized = vi.fn();
    render(<ImageQuestionInput ref={ref} onRecognized={onRecognized} />);

    act(() => ref.current?.selectFile(new File(['image'], 'question.png', { type: 'image/png' })));
    fireEvent.click(screen.getByRole('button', { name: '识别并开始分析' }));

    await vi.waitFor(() => {
      expect(onRecognized).toHaveBeenCalledWith('**题型：** 解析几何\n\n已知椭圆 $C$。', true);
    });
  });

  it('returns uncertain recognition to the editor for confirmation', async () => {
    vi.mocked(recognizeQuestionImage).mockResolvedValue({
      image: { height: 800, width: 1200 },
      recognition: {
        answerMarkdown: null,
        questionType: null,
        stemMarkdown: '求 $x$。',
        uncertain: ['指数可能是 2 或 3'],
      },
    });
    const ref = createRef<ImageQuestionInputHandle>();
    const onRecognized = vi.fn();
    render(<ImageQuestionInput ref={ref} onRecognized={onRecognized} />);

    act(() => ref.current?.selectFile(new File(['image'], 'question.png', { type: 'image/png' })));
    fireEvent.click(screen.getByRole('button', { name: '识别并开始分析' }));

    expect(await screen.findByText(/有 1 处内容不确定/)).toBeInTheDocument();
    expect(screen.getByText('指数可能是 2 或 3')).toBeInTheDocument();
    expect(onRecognized).toHaveBeenCalledWith('求 $x$。', false);
  });
});
