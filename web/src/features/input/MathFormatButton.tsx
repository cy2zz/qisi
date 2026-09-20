import { useEffect, useRef, useState } from 'react';
import { formatMathDraft } from './math-format-client';

type FormatState = 'error' | 'idle' | 'loading' | 'success' | 'unchanged';

interface MathFormatButtonProps {
  disabled?: boolean;
  onFormatted: (markdown: string) => void;
  text: string;
}

const stateLabels: Record<FormatState, { accessible: string; visible: string }> = {
  error: { accessible: '公式转换失败，请重试', visible: '重试转换' },
  idle: { accessible: '公式转换', visible: '公式转换' },
  loading: { accessible: '正在转换公式', visible: '转换中…' },
  success: { accessible: '公式已转换', visible: '已转换' },
  unchanged: { accessible: '没有检测到需要转换的公式', visible: '无需转换' },
};

export function MathFormatButton({
  disabled = false,
  onFormatted,
  text,
}: MathFormatButtonProps) {
  const [state, setState] = useState<FormatState>('idle');
  const lastFormattedTextRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (text !== lastFormattedTextRef.current) setState('idle');
  }, [text]);

  async function handleFormat() {
    const source = text.trim();
    if (!source || disabled || state === 'loading') return;

    const requestNumber = ++requestRef.current;
    setState('loading');
    try {
      const result = await formatMathDraft(source);
      if (requestRef.current !== requestNumber || textRef.current.trim() !== source) return;
      if (!result.formatted) {
        setState('unchanged');
        return;
      }

      lastFormattedTextRef.current = result.markdown;
      onFormatted(result.markdown);
      setState('success');
    } catch {
      if (requestRef.current === requestNumber && textRef.current.trim() === source) {
        setState('error');
      }
    }
  }

  const label = stateLabels[state];
  return (
    <button
      className="composer-format-trigger"
      type="button"
      aria-label={label.accessible}
      data-state={state}
      data-tooltip={label.accessible}
      disabled={disabled || !text.trim() || state === 'loading'}
      title={label.accessible}
      onClick={() => void handleFormat()}
    >
      <span className="composer-format-symbol" aria-hidden="true">ƒx</span>
      <span className="composer-format-label">{label.visible}</span>
      <span className="sr-only" role="status" aria-live="polite">{label.accessible}</span>
    </button>
  );
}
