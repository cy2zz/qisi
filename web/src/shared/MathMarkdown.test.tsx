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

  it('renders model-style parenthesis and bracket mathematics', () => {
    const view = render(
      <MathMarkdown
        content={'分母中的 \\(\\sqrt3\\) 需要有理化：\\[ \\frac{\\sqrt2}{\\sqrt3} \\]'}
      />,
    );

    expect(view.container.querySelectorAll('.katex')).toHaveLength(2);
    expect(view.container.querySelector('.katex-display')).not.toBeNull();
  });

  it('repairs bracketed LaTeX when a model drops the math delimiter backslashes', () => {
    const view = render(
      <MathMarkdown
        content={String.raw`试着把 [ \frac{\sqrt2}{\sqrt3} ] 的分子分母同时乘以 \(\sqrt3\)：[ \frac{\sqrt2}{\sqrt3}\times \frac{\sqrt3}{\sqrt3} ]`}
      />,
    );

    expect(view.container.querySelectorAll('.katex')).toHaveLength(3);
    expect(view.container.querySelector('.katex-error')).toBeNull();
  });

  it('repairs the bare parenthesized formula variant shown in a teaching reply', () => {
    const view = render(
      <MathMarkdown
        content={String.raw`试着把 [ \frac{\sqrt2}{\sqrt3} ] 的分子分母同时乘以 (\sqrt3)：[ \frac{\sqrt2}{\sqrt3}\times \frac{\sqrt3}{\sqrt3} ]`}
      />,
    );

    expect(view.container.querySelectorAll('.katex')).toHaveLength(3);
    expect(view.container).not.toHaveTextContent('(\\sqrt3)');
  });

  it('repairs asymmetric bracket delimiters from a teaching reply', () => {
    const view = render(
      <MathMarkdown
        content={String.raw`试着把 \[ \frac{\sqrt2}{\sqrt3} ] 的分子分母同时乘以 (\sqrt3)：[ \frac{\sqrt2}{\sqrt3}\times
\frac{\sqrt3}{\sqrt3} \]`}
      />,
    );

    expect(view.container.querySelectorAll('.katex')).toHaveLength(3);
    expect(view.container.querySelector('.katex-error')).toBeNull();
  });

  it('repairs JSON-style double-escaped model mathematics', () => {
    const view = render(
      <MathMarkdown
        content={String.raw`试着把 \\[ \\frac{\\sqrt2}{\\sqrt3} \\] 的分子分母同时乘以 \\(\\sqrt3\\)：\\[ \\frac{\\sqrt2}{\\sqrt3}\\times \\frac{\\sqrt3}{\\sqrt3} \\]`}
      />,
    );

    expect(view.container.querySelectorAll('.katex')).toHaveLength(3);
    expect(view.container.querySelector('.katex-error')).toBeNull();
  });

  it('does not reinterpret ordinary brackets or Markdown links as mathematics', () => {
    const view = render(
      <MathMarkdown content={'区间 [2, 5] 保持原样，并查看 [题目来源](https://example.com)。'} />,
    );

    expect(view.container.querySelector('.katex')).toBeNull();
    expect(view.container).toHaveTextContent('[2, 5]');
    expect(view.getByRole('link', { name: '题目来源' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });

  it('keeps literal math delimiters inside code unchanged', () => {
    const view = render(<MathMarkdown content={'示例：`\\(x+1\\)`\n\n```text\n\\[x+1\\]\n```'} />);

    expect(view.container.querySelector('.katex')).toBeNull();
    expect(view.container).toHaveTextContent('\\(x+1\\)');
    expect(view.container).toHaveTextContent('\\[x+1\\]');
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
