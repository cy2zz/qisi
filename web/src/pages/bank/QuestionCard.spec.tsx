import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionCard, type BankQuestion } from './QuestionCard';

const imageQuestion: BankQuestion = {
  id: '801',
  imageHeight: 425,
  imageWidth: 1600,
  number: 1,
  questionCode: '2024北京#01',
  questionImageUrl: 'https://example.test/question.png',
  statementMarkdown: null,
  status: 'ready',
};

const initialInnerWidth = window.innerWidth;

describe('QuestionCard', () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialInnerWidth });
  });

  it('keeps selection unavailable until the OSS question image is readable', () => {
    const onSelect = vi.fn();
    render(<QuestionCard question={imageQuestion} onSelect={onSelect} />);

    const image = screen.getByRole('img', { name: '第 1 题题目' });
    expect(screen.getByText('题面读取中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择第 1 题' })).toBeDisabled();

    fireEvent.load(image);

    expect(screen.getByText('题面可读')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择第 1 题' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '选择第 1 题' }));
    expect(onSelect).toHaveBeenCalledWith(imageQuestion);
  });

  it('shows a compact retryable state when the question image fails', () => {
    render(<QuestionCard question={imageQuestion} onSelect={vi.fn()} />);

    fireEvent.error(screen.getByRole('img', { name: '第 1 题题目' }));

    expect(screen.getByRole('alert')).toHaveTextContent('题图没有加载成功');
    expect(screen.getByText('题面需重试')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择第 1 题' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重新加载第 1 题题图' }));
    expect(screen.getByText('题面读取中')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '第 1 题题目' })).toBeInTheDocument();
  });

  it('renders mathematical Markdown without waiting for an image', () => {
    render(
      <QuestionCard
        question={{
          ...imageQuestion,
          id: '802',
          number: 2,
          questionImageUrl: null,
          statementMarkdown: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$。`,
        }}
        onSelect={vi.fn()}
      />,
    );

    const card = screen.getByRole('article', { name: '第 2 题' });
    expect(card.querySelector('.katex')).not.toBeNull();
    expect(screen.getByText('题面可读')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择第 2 题' })).toBeEnabled();
  });

  it('uses a compact unavailable state instead of an empty question sheet', () => {
    render(
      <QuestionCard
        question={{
          ...imageQuestion,
          id: '803',
          number: 3,
          questionImageUrl: null,
          statementMarkdown: null,
        }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('题面暂不可用');
    expect(screen.getByRole('button', { name: '选择第 3 题' })).toBeDisabled();
  });

  it('offers an explicit zoom mode for wide question images', () => {
    render(<QuestionCard question={imageQuestion} onSelect={vi.fn()} />);
    fireEvent.load(screen.getByRole('img', { name: '第 1 题题目' }));

    const zoom = screen.getByRole('button', { name: '放大阅读第 1 题' });
    fireEvent.click(zoom);

    expect(screen.getByTestId('question-image-scroll')).toHaveAttribute('data-zoomed', 'true');
    expect(screen.getByRole('button', { name: '适合宽度显示第 1 题' })).toBeInTheDocument();
  });

  it('starts wide OSS question images at a readable scale on H5', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(<QuestionCard question={imageQuestion} onSelect={vi.fn()} />);
    fireEvent.load(screen.getByRole('img', { name: '第 1 题题目' }));

    expect(screen.getByTestId('question-image-scroll')).toHaveAttribute('data-zoomed', 'true');
    expect(screen.getByRole('button', { name: '适合宽度显示第 1 题' })).toBeInTheDocument();
  });

  it('keeps an invalid bank item visible without letting it enter study', () => {
    render(
      <QuestionCard
        question={{
          ...imageQuestion,
          id: '804',
          number: 4,
          questionImageUrl: null,
          statementMarkdown: '题面原始记录',
          status: 'invalid',
        }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText('资料异常')).toHaveLength(2);
    expect(screen.getByText('这道题的题库资料异常，保留可见但不会进入作答')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂不可选第 4 题' })).toBeDisabled();
  });

  it('labels a needs-review item while preserving explicit selection', () => {
    render(
      <QuestionCard
        question={{
          ...imageQuestion,
          id: '805',
          number: 5,
          questionImageUrl: null,
          statementMarkdown: '题面待核对',
          status: 'needs_review',
        }}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('待核对')).toBeInTheDocument();
    expect(screen.getByText(/选择后会保留这道题而不暗换题/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择第 5 题' })).toBeEnabled();
  });
});
