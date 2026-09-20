import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MATH_FORMULA_SHORTCUTS } from '../../shared/math-input';
import {
  RichComposer,
  type RichComposerHandle,
  richTextToMarkdown,
} from './RichComposer';

describe('richTextToMarkdown', () => {
  afterEach(cleanup);

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

  it('updates realtime speech in place and replaces it with the final LaTeX draft', () => {
    const ref = createRef<RichComposerHandle>();
    const onChange = vi.fn();
    render(
      <RichComposer
        ref={ref}
        placeholder="输入题目"
        onChange={onChange}
        onSubmit={vi.fn()}
      />,
    );

    act(() => ref.current?.updateVoiceDraft('根号2'));
    act(() => ref.current?.updateVoiceDraft('根号2除以根号3'));
    expect(screen.getByRole('textbox')).toHaveTextContent('根号2除以根号3');
    expect(screen.getByRole('textbox')).not.toHaveTextContent('根号2根号2');

    act(() => ref.current?.commitVoiceDraft('$\\frac{\\sqrt{2}}{\\sqrt{3}}$'));
    expect(screen.getByRole('textbox')).toHaveTextContent('$\\frac{\\sqrt{2}}{\\sqrt{3}}$');
    expect(onChange).toHaveBeenLastCalledWith('$\\frac{\\sqrt{2}}{\\sqrt{3}}$');
  });

  it('replaces a manually entered draft with formatted Markdown and LaTeX', () => {
    const ref = createRef<RichComposerHandle>();
    const onChange = vi.fn();
    render(
      <RichComposer
        ref={ref}
        placeholder="输入题目"
        onChange={onChange}
        onSubmit={vi.fn()}
      />,
    );

    act(() => ref.current?.insertText('根号2除以根号3等于多少？'));
    act(() => ref.current?.replaceText('$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？'));

    expect(screen.getByRole('textbox')).toHaveTextContent(
      '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
    );
    expect(onChange).toHaveBeenLastCalledWith('$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？');
  });

  it('lets narrow-screen students reveal low-frequency text formatting on demand', () => {
    render(
      <RichComposer
        placeholder="输入题目"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('button', { name: '更多文字格式' });
    const toolbar = screen.getByRole('toolbar', { name: '文字格式' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toolbar).toHaveAttribute('data-open', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toolbar).toHaveAttribute('data-open', 'true');

    fireEvent.keyDown(toolbar, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('places the caret in formula slots and uses Tab to advance', () => {
    const ref = createRef<RichComposerHandle>();
    const onChange = vi.fn();
    render(
      <RichComposer
        ref={ref}
        placeholder="输入题目"
        onChange={onChange}
        onSubmit={vi.fn()}
      />,
    );

    act(() => ref.current?.insertFormulaTemplate('$\\frac{}{}$'));
    const editor = screen.getByRole('textbox');
    const formulaNode = editor.firstChild as Text;
    expect(window.getSelection()?.anchorNode).toBe(formulaNode);
    expect(window.getSelection()?.anchorOffset).toBe(formulaNode.data.indexOf('{}') + 1);
    expect(onChange).toHaveBeenLastCalledWith('$\\frac{}{}$');

    formulaNode.data = '$\\frac{2}{}$';
    const firstValueEnd = formulaNode.data.indexOf('2') + 1;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(formulaNode, firstValueEnd);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(window.getSelection()?.anchorOffset).toBe(formulaNode.data.indexOf('{}') + 1);

    formulaNode.data = '$\\frac{2}{3}$';
    const secondValueEnd = formulaNode.data.indexOf('3') + 1;
    range.setStart(formulaNode, secondValueEnd);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(window.getSelection()?.anchorOffset).toBe(formulaNode.data.length);
  });

  it('keeps Enter inside a multiline derivation and uses Ctrl or Command plus Enter to send', () => {
    const ref = createRef<RichComposerHandle>();
    const onSubmit = vi.fn();
    render(
      <RichComposer
        ref={ref}
        placeholder="输入题目"
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    act(() => ref.current?.insertText('第一步\n第二步'));
    const editor = screen.getByRole('textbox');

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { ctrlKey: true, key: 'Enter' });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('inserts empty proof and case-analysis structures without sending or supplying a solution', () => {
    const ref = createRef<RichComposerHandle>();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RichComposer
        ref={ref}
        placeholder="输入题目"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '插入证明结构' }));
    expect(screen.getByRole('textbox')).toHaveTextContent('要证：');
    expect(screen.getByRole('textbox')).toHaveTextContent('依据：');
    expect(screen.getByRole('textbox')).toHaveTextContent('结论：');
    expect(onChange).toHaveBeenLastCalledWith(
      '要证：\n依据：\n证明：\n步骤 1：\n步骤 2：\n结论：',
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveFocus();

    act(() => ref.current?.clear());
    fireEvent.click(screen.getByRole('button', { name: '插入分类讨论结构' }));
    expect(onChange).toHaveBeenLastCalledWith(
      '分类依据：\n情况 1：\n情况 2：\n综上：',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('moves through the multiline equation-chain slots without leaving the draft', () => {
    const ref = createRef<RichComposerHandle>();
    render(
      <RichComposer
        ref={ref}
        placeholder="输入题目"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const template = MATH_FORMULA_SHORTCUTS.find(
      (shortcut) => shortcut.name === '插入多步等式链',
    );
    expect(template).toBeDefined();

    act(() => ref.current?.insertFormulaTemplate(template!.syntax));
    const formulaNode = screen.getByRole('textbox').firstChild as Text;
    const firstSlot = formulaNode.data.indexOf('{}');
    const secondSlot = formulaNode.data.indexOf('{}', firstSlot + 2);
    expect(window.getSelection()?.anchorOffset).toBe(firstSlot + 1);

    act(() => expect(ref.current?.advanceFormulaSlot()).toBe(true));
    expect(window.getSelection()?.anchorOffset).toBe(secondSlot + 1);
  });

  it('hands a pasted image to the question image flow instead of inserting unsafe HTML', () => {
    const onImagePaste = vi.fn();
    render(
      <RichComposer
        placeholder="输入题目"
        onChange={vi.fn()}
        onImagePaste={onImagePaste}
        onSubmit={vi.fn()}
      />,
    );
    const file = new File(['image'], 'question.png', { type: 'image/png' });

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        getData: vi.fn().mockReturnValue(''),
        items: [{ getAsFile: () => file, kind: 'file', type: 'image/png' }],
      },
    });

    expect(onImagePaste).toHaveBeenCalledWith(file);
    expect(screen.getByRole('textbox')).toHaveTextContent('');
  });
});
