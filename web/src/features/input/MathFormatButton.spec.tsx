import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MathFormatButton } from './MathFormatButton';
import { formatMathDraft } from './math-format-client';

vi.mock('./math-format-client', () => ({
  formatMathDraft: vi.fn(),
}));

describe('MathFormatButton', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('formats the current manual draft and returns Markdown with LaTeX', async () => {
    vi.mocked(formatMathDraft).mockResolvedValue({
      formatted: true,
      markdown: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
    });
    const onFormatted = vi.fn();
    render(
      <MathFormatButton
        text="根号2除以根号3等于多少？"
        onFormatted={onFormatted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '公式转换' }));

    expect(await screen.findByRole('button', { name: '公式已转换' })).toBeInTheDocument();
    expect(formatMathDraft).toHaveBeenCalledWith('根号2除以根号3等于多少？');
    expect(onFormatted).toHaveBeenCalledWith('$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？');
  });

  it('keeps the draft and offers retry when conversion fails', async () => {
    vi.mocked(formatMathDraft).mockRejectedValue(new Error('unavailable'));
    render(<MathFormatButton text="x的平方" onFormatted={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '公式转换' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '公式转换失败，请重试' })).toBeEnabled();
    });
  });

  it('is disabled when the composer is empty', () => {
    render(<MathFormatButton text="   " onFormatted={vi.fn()} />);

    expect(screen.getByRole('button', { name: '公式转换' })).toBeDisabled();
  });
});
