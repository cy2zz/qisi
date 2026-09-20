import {
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

const droppedTags = new Set(['AUDIO', 'IFRAME', 'IMG', 'SCRIPT', 'STYLE', 'SVG', 'VIDEO']);

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement) || droppedTags.has(node.tagName)) return '';

  const content = Array.from(node.childNodes).map(nodeToMarkdown).join('');
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'STRONG' || node.tagName === 'B') return content ? `**${content}**` : '';
  if (node.tagName === 'EM' || node.tagName === 'I') return content ? `*${content}*` : '';
  if (node.tagName === 'P' || node.tagName === 'DIV') return `${content}\n\n`;
  if (node.tagName === 'UL' || node.tagName === 'OL') {
    return `${Array.from(node.children)
      .filter((child) => child.tagName === 'LI')
      .map((child, index) => {
        const item = Array.from(child.childNodes).map(nodeToMarkdown).join('').trim();
        return `${node.tagName === 'OL' ? `${index + 1}.` : '-'} ${item}`;
      })
      .join('\n')}\n\n`;
  }
  return content;
}

export function richTextToMarkdown(editor: HTMLElement) {
  return Array.from(editor.childNodes)
    .map(nodeToMarkdown)
    .join('')
    .replaceAll('\u00a0', ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RichComposerHandle {
  advanceFormulaSlot: () => boolean;
  clear: () => void;
  commitVoiceDraft: (text: string) => void;
  focus: (options?: FocusOptions) => void;
  insertFormulaTemplate: (text: string) => void;
  insertText: (text: string) => void;
  replaceText: (text: string, options?: { focus?: boolean }) => void;
  updateVoiceDraft: (text: string) => void;
}

interface RichComposerProps {
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onImagePaste?: (file: File) => void;
  onSubmit: () => void;
  placeholder: string;
}

type FormatCommand = 'bold' | 'insertOrderedList' | 'insertUnorderedList' | 'italic';

const formattingActions: Array<{
  command: FormatCommand;
  content: ReactNode;
  label: string;
}> = [
  { command: 'bold', content: <strong>B</strong>, label: '加粗' },
  { command: 'italic', content: <em>I</em>, label: '斜体' },
  { command: 'insertUnorderedList', content: '• 列表', label: '项目符号' },
  { command: 'insertOrderedList', content: '1. 列表', label: '编号列表' },
];

export const RichComposer = forwardRef<RichComposerHandle, RichComposerProps>(
  function RichComposer(
    { disabled = false, onChange, onImagePaste, onSubmit, placeholder },
    forwardedRef,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const formattingToggleRef = useRef<HTMLButtonElement>(null);
    const voiceDraftNodeRef = useRef<Text | null>(null);
    const formattingToolbarId = useId();
    const [activeFormats, setActiveFormats] = useState<Partial<Record<FormatCommand, boolean>>>({});
    const [formattingOpen, setFormattingOpen] = useState(false);

    function emitChange() {
      if (editorRef.current) onChange(richTextToMarkdown(editorRef.current));
    }

    function insertTextNode(text: string) {
      const editor = editorRef.current;
      if (!editor) return null;
      editor.focus();

      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const textNode = document.createTextNode(text);
      if (range && editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        editor.append(textNode);
      }
      return textNode;
    }

    function insertText(text: string) {
      insertTextNode(text);
      emitChange();
    }

    function placeCaret(node: Text, offset: number) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(node, Math.max(0, Math.min(offset, node.data.length)));
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    function insertFormulaTemplate(text: string) {
      const textNode = insertTextNode(text);
      if (!textNode) return;
      const firstSlot = text.indexOf('{}');
      placeCaret(textNode, firstSlot >= 0 ? firstSlot + 1 : text.length);
      emitChange();
    }

    function moveToNextFormulaSlot() {
      const editor = editorRef.current;
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      if (!editor || !selection || !(node instanceof Text) || !editor.contains(node)) return false;

      const caretOffset = selection.anchorOffset;
      const formulaStart = node.data.lastIndexOf('$', Math.max(0, caretOffset - 1));
      const formulaEnd = node.data.indexOf('$', caretOffset);
      if (formulaStart < 0 || formulaEnd < 0 || formulaEnd <= formulaStart) return false;

      const nextSlot = node.data.indexOf('{}', caretOffset);
      placeCaret(node, nextSlot >= 0 && nextSlot < formulaEnd ? nextSlot + 1 : formulaEnd + 1);
      return true;
    }

    function replaceText(text: string, options?: { focus?: boolean }) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.replaceChildren(document.createTextNode(text));
      voiceDraftNodeRef.current = null;
      emitChange();
      if (options?.focus !== false) editor.focus();
    }

    function updateVoiceDraft(text: string) {
      const editor = editorRef.current;
      const current = voiceDraftNodeRef.current;
      if (editor && current && editor.contains(current)) current.data = text;
      else voiceDraftNodeRef.current = insertTextNode(text);
      emitChange();
    }

    function commitVoiceDraft(text: string) {
      updateVoiceDraft(text);
      voiceDraftNodeRef.current = null;
    }

    function refreshFormats() {
      const next: Partial<Record<FormatCommand, boolean>> = {};
      for (const { command } of formattingActions) {
        try {
          next[command] = document.queryCommandState(command);
        } catch {
          next[command] = false;
        }
      }
      setActiveFormats(next);
    }

    function applyFormat(command: FormatCommand) {
      editorRef.current?.focus();
      document.execCommand(command, false);
      refreshFormats();
      emitChange();
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.key === 'Tab' && !event.shiftKey && moveToNextFormulaSlot()) {
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onSubmit();
      }
    }

    useImperativeHandle(forwardedRef, () => ({
      advanceFormulaSlot: moveToNextFormulaSlot,
      clear() {
        if (editorRef.current) editorRef.current.replaceChildren();
        voiceDraftNodeRef.current = null;
        onChange('');
      },
      commitVoiceDraft,
      focus(options) {
        editorRef.current?.focus(options);
      },
      insertFormulaTemplate,
      insertText,
      replaceText,
      updateVoiceDraft,
    }));

    return (
      <div className="rich-composer" data-formatting-open={formattingOpen}>
        <button
          ref={formattingToggleRef}
          type="button"
          className="rich-composer-format-toggle"
          aria-controls={formattingToolbarId}
          aria-expanded={formattingOpen}
          aria-label="更多文字格式"
          title="更多文字格式"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setFormattingOpen((current) => !current)}
        >
          <span aria-hidden="true">Aa</span>
        </button>
        <div
          id={formattingToolbarId}
          className="rich-composer-toolbar"
          role="toolbar"
          aria-label="文字格式"
          data-open={formattingOpen}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setFormattingOpen(false);
            formattingToggleRef.current?.focus();
          }}
        >
          {formattingActions.map((action) => (
            <button
              type="button"
              key={action.command}
              aria-label={action.label}
              aria-pressed={Boolean(activeFormats[action.command])}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyFormat(action.command)}
            >
              {action.content}
            </button>
          ))}
        </div>
        <div
          ref={editorRef}
          aria-label="输入题目或想法"
          aria-multiline="true"
          className="rich-composer-editor"
          contentEditable={!disabled}
          data-placeholder={placeholder}
          role="textbox"
          suppressContentEditableWarning
          onInput={emitChange}
          onKeyDown={handleKeyDown}
          onKeyUp={refreshFormats}
          onMouseUp={refreshFormats}
          onPaste={(event) => {
            event.preventDefault();
            const image = Array.from(event.clipboardData.items)
              .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
              ?.getAsFile();
            if (image && onImagePaste) {
              onImagePaste(image);
              return;
            }
            insertText(event.clipboardData.getData('text/plain'));
          }}
        />
      </div>
    );
  },
);
