import { describe, expect, it } from 'vitest';
import { richTextToMarkdown } from './RichComposer';

describe('richTextToMarkdown', () => {
  it('keeps supported rich text as safe Markdown and LaTeX', () => {
    const editor = document.createElement('div');
    editor.innerHTML = [
      '<div><strong>先求导</strong>，再看 <em>$f\'(x)$</em></div>',
      '<ul><li>找零点</li><li>判断正负</li></ul>',
    ].join('');

    expect(richTextToMarkdown(editor)).toBe(
      "**先求导**，再看 *$f'(x)$*\n\n- 找零点\n- 判断正负",
    );
  });

  it('drops pasted or injected HTML structure outside the supported format set', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<div>第一步<script>bad()</script><img src=x onerror=bad()></div>';

    expect(richTextToMarkdown(editor)).toBe('第一步');
  });
});
