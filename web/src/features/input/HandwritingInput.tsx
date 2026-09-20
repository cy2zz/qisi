import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MathMarkdown } from '../../shared/MathMarkdown';
import {
  confirmHandwriting,
  transcribeHandwriting,
  transcriptToMarkdown,
  type TranscriptDraft,
} from './handwriting-client';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

type HandwritingState = 'confirming' | 'error' | 'idle' | 'recognizing' | 'review';

export interface ConfirmedHandwriting {
  markdown: string;
  revision: number;
  transcriptId: string;
}

export interface HandwritingInputHandle {
  clear: () => void;
  openFilePicker: () => void;
  selectFile: (file: File) => void;
}

export const HandwritingInput = forwardRef<
  HandwritingInputHandle,
  {
    disabled?: boolean;
    onConfirmed: (result: ConfirmedHandwriting) => void;
    onReviewingChange?: (reviewing: boolean) => void;
    sessionId: string;
  }
>(function HandwritingInput(
  { disabled = false, onConfirmed, onReviewingChange, sessionId },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [draft, setDraft] = useState<TranscriptDraft | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<HandwritingState>('idle');
  const [status, setStatus] = useState('');

  function clear() {
    requestRef.current += 1;
    setDraft(null);
    setFile(null);
    setState('idle');
    setStatus('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function selectFile(nextFile: File) {
    requestRef.current += 1;
    setDraft(null);
    if (!supportedTypes.has(nextFile.type) || nextFile.size > MAX_IMAGE_BYTES) {
      setFile(null);
      setState('error');
      setStatus('只支持 8MB 以内的 JPEG、PNG 或 WebP 图片');
      return;
    }
    setFile(nextFile);
    setState('idle');
    setStatus('图片已加入；识别后需要先核对转写，不会直接判题。');
  }

  useEffect(() => {
    onReviewingChange?.(Boolean(file));
  }, [file, onReviewingChange]);

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useImperativeHandle(forwardedRef, () => ({
    clear,
    openFilePicker() {
      if (!disabled) inputRef.current?.click();
    },
    selectFile,
  }));

  async function recognize() {
    if (!file || disabled || state === 'recognizing') return;
    const requestNumber = ++requestRef.current;
    setState('recognizing');
    setStatus('正在忠实逐行转写，不会纠正数学内容…');
    try {
      const result = await transcribeHandwriting(file, sessionId);
      if (requestRef.current !== requestNumber) return;
      setDraft(result.transcript);
      setState('review');
      setStatus('请逐行核对；标为“待确认”的行必须明确确认或修改。');
    } catch {
      if (requestRef.current !== requestNumber) return;
      setState('error');
      setStatus('手写识别失败，原图仍保留在当前页面，可以重试。');
    }
  }

  function updateLine(index: number, text: string) {
    setDraft((current) => current && ({
      ...current,
      lines: current.lines.map((line) => line.index === index
        ? { ...line, explicitly_confirmed: line.uncertain || line.explicitly_confirmed, text }
        : line),
    }));
  }

  function confirmLine(index: number) {
    setDraft((current) => current && ({
      ...current,
      lines: current.lines.map((line) => line.index === index
        ? { ...line, explicitly_confirmed: true }
        : line),
    }));
  }

  async function confirm() {
    if (!draft || disabled || state === 'confirming') return;
    setState('confirming');
    setStatus('正在保存你确认的转写版本…');
    try {
      const confirmed = await confirmHandwriting(draft);
      onConfirmed({
        markdown: transcriptToMarkdown(confirmed.lines),
        revision: confirmed.revision,
        transcriptId: confirmed.id,
      });
      clear();
    } catch {
      setState('review');
      setStatus('确认没有保存；请保留当前核对内容并重试。');
    }
  }

  const unresolved = draft?.lines.some((line) => line.uncertain && !line.explicitly_confirmed)
    ?? false;

  return (
    <div className="handwriting-input" data-state={state}>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择手写作答图片"
        onChange={(event) => {
          const nextFile = event.target.files?.[0];
          if (nextFile) selectFile(nextFile);
        }}
      />
      {file ? (
        <section className="handwriting-review" aria-label="手写转写核对">
          <header>
            {previewUrl ? <img src={previewUrl} alt="待核对手写作答原图" /> : null}
            <div>
              <span>HANDWRITING / 忠实转写</span>
              <strong>{file.name || '手写作答图片'}</strong>
              <p role="status">{status}</p>
            </div>
            <button type="button" disabled={state === 'recognizing' || state === 'confirming'} onClick={clear}>
              移除
            </button>
          </header>
          {!draft ? (
            <button type="button" disabled={disabled || state === 'recognizing'} onClick={() => void recognize()}>
              {state === 'recognizing' ? '正在识别…' : state === 'error' ? '重新识别手写作答' : '识别手写作答'}
            </button>
          ) : (
            <>
              <div className="handwriting-lines">
                {draft.lines.map((line) => (
                  <article key={line.index} data-uncertain={line.uncertain} data-confirmed={line.explicitly_confirmed}>
                    <div>
                      <strong>第 {line.index} 行</strong>
                      {line.uncertain ? (
                        <span>{line.explicitly_confirmed ? '已确认' : '待确认'}</span>
                      ) : <span>清晰</span>}
                    </div>
                    <textarea
                      aria-label={`第 ${line.index} 行转写`}
                      disabled={disabled || state === 'confirming'}
                      value={line.text}
                      onChange={(event) => updateLine(line.index, event.target.value)}
                    />
                    <MathMarkdown content={line.text} />
                    {line.uncertain && !line.explicitly_confirmed ? (
                      <button type="button" aria-label={`确认第 ${line.index} 行`} onClick={() => confirmLine(line.index)}>
                        这行转写无误
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
              <footer>
                <span>确认表示“转写与原图一致”，不表示数学答案正确。</span>
                <button type="button" disabled={disabled || unresolved || state === 'confirming'} onClick={() => void confirm()}>
                  {state === 'confirming' ? '正在保存确认…' : '确认转写并放入输入框'}
                </button>
              </footer>
            </>
          )}
        </section>
      ) : state === 'error' && status ? <p className="image-question-error" role="alert">{status}</p> : null}
    </div>
  );
});
