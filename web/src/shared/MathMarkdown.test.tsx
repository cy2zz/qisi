import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MathMarkdown } from './MathMarkdown';

describe('MathMarkdown', () => {
  afterEach(cleanup);

  it('renders Chinese Markdown with inline and block mathematics', () => {
    const view = render(
      <MathMarkdown
        content={'先看函数 $f(x)=x^2$。\n\n$$\n\\frac{1}{2}+\\frac{1}{2}=1\n$$'}
      />,
    );

    expect(view.getByText(/先看函数/)).toBeInTheDocument();
    expect(view.container.querySelector('.katex')).not.toBeNull();
    expect(view.container.querySelector('.katex-display')).not.toBeNull();
  });

  it('keeps malformed mathematics visible instead of throwing', () => {
    const view = render(<MathMarkdown content={'这一步暂时无法解析：$\\frac{1}$'} />);

    const fallback = view.container.querySelector('.katex-error');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent('\\frac{1}');
  });

  it('does not render untrusted raw HTML', () => {
    const view = render(
      <MathMarkdown content={'安全正文<script>window.alert("xss")</script><b>不可信标签</b>'} />,
    );

    expect(view.container).toHaveTextContent('安全正文');
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('b')).toBeNull();
  });
});
