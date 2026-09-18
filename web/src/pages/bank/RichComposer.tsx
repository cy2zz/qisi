import {
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
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
  clear: () => void;
  focus: () => void;
  insertText: (text: string) => void;
}

interface RichComposerProps {
  disabled?: boolean;
  onChange: (markdown: string) => void;
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
  function RichComposer({ disabled = false, onChange, onSubmit, placeholder }, forwardedRef) {
    const editorRef = useRef<HTMLDivElement>(null);
    const [activeFormats, setActiveFormats] = useState<Partial<Record<FormatCommand, boolean>>>({});

    function emitChange() {
      if (editorRef.current) onChange(richTextToMarkdown(editorRef.current));
    }

    function insertText(text: string) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();

      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        editor.append(document.createTextNode(text));
      }
      emitChange();
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
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onSubmit();
      }
    }

    useImperativeHandle(forwardedRef, () => ({
      clear() {
        if (editorRef.current) editorRef.current.replaceChildren();
        onChange('');
      },
      focus() {
        editorRef.current?.focus();
      },
      insertText,
    }));

    return (
      <div className="rich-composer">
        <div className="rich-composer-toolbar" role="toolbar" aria-label="文字格式">
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
            insertText(event.clipboardData.getData('text/plain'));
          }}
        />
      </div>
    );
  },
);
