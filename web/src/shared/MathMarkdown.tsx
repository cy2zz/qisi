import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';

interface MathMarkdownProps {
  className?: string;
  content: string;
  interactiveImages?: boolean;
}

interface ActiveMathImage {
  alt: string;
  src: string;
}

const imageZoomSteps = [100, 125, 150, 200] as const;

const bracketMathPattern =
  /([ \t]*)(\\?)\[\s*((?=[^\]]*\\(?:begin|cdot|cos|d?frac|div|geq|infty|int|left|leq|lim|ln|log|mathbb|neq|overline|parallel|perp|pm|prod|right|sin|sqrt|sum|tan|text|times|underline|vec)(?![A-Za-z]))[^\]]+?)\s*(\\?)\]/g;
const bareParenthesizedMathPattern =
  /\(\s*((?=[^)\n]*\\(?:begin|cdot|cos|d?frac|div|geq|infty|int|left|leq|lim|ln|log|mathbb|neq|overline|parallel|perp|pm|prod|right|sin|sqrt|sum|tan|text|times|underline|vec))[^)\n]+?)\s*\)/g;
const doubleEscapedMathPattern =
  /\\\\(?=(?:\[|]|\(|\)|(?:begin|cdot|cos|d?frac|div|geq|infty|int|left|leq|lim|ln|log|mathbb|neq|overline|parallel|perp|pm|prod|right|sin|sqrt|sum|tan|text|times|underline|vec)(?![A-Za-z])))/g;
const codeSegmentPattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const protectedMarkdownSegmentPattern =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g;

export function normalizeModelMathDelimiters(content: string) {
  const canonicalDelimiters = content
    .split(codeSegmentPattern)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      return segment
        // A model may JSON-escape an already escaped formula, leaving two
        // literal backslashes after transport decoding. Collapse only known
        // math delimiters and commands; keep intentional LaTeX line breaks.
        .replace(doubleEscapedMathPattern, '\\')
        // Repair bracket formula boundaries as one pair before handling
        // canonical delimiters. Models sometimes emit only one delimiter
        // backslash (`\[... ]` or `[..., \]`), which would otherwise leave an
        // unclosed dollar delimiter and make the whole formula render as text.
        .replace(
          bracketMathPattern,
          (
            _match,
            leadingSpace: string,
            openingSlash: string,
            math: string,
            closingSlash: string,
          ) => {
            const normalizedMath = math.trim();
            const useDisplayMath =
              (openingSlash === '\\' && closingSlash === '\\')
              || normalizedMath.includes('\n');

            return useDisplayMath
              ? `\n\n$$\n${normalizedMath}\n$$\n\n`
              : `${leadingSpace}$${normalizedMath}$`;
          },
        )
        .replace(/[ \t]*\\\[/g, () => '\n\n$$\n')
        .replace(/\\\][ \t]*/g, () => '\n$$\n\n')
        .replace(/\\\(/g, () => '$')
        .replace(/\\\)/g, () => '$');
    })
    .join('');

  return canonicalDelimiters
    .split(protectedMarkdownSegmentPattern)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      return segment
        // The same delimiter loss can leave an inline formula looking like
        // `(\sqrt3)`. Only repair parentheses containing a known command.
        .replace(bareParenthesizedMathPattern, (_match, math: string) => `$${math.trim()}$`);
    })
    .join('');
}

export function MathMarkdown({ className, content, interactiveImages = false }: MathMarkdownProps) {
  const [activeImage, setActiveImage] = useState<ActiveMathImage | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const imageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const imageTriggerSourceRef = useRef<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  function closeImageViewer() {
    setActiveImage(null);
    requestAnimationFrame(() => {
      imageTriggerRef.current?.focus();
      imageTriggerSourceRef.current = null;
    });
  }

  useEffect(() => {
    if (!activeImage) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleViewerKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeImageViewer();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoomIndex((current) => Math.min(imageZoomSteps.length - 1, current + 1));
        return;
      }
      if (event.key === '-') {
        event.preventDefault();
        setZoomIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        setZoomIndex(0);
        return;
      }
      if (event.key !== 'Tab' || !viewerRef.current) return;

      const actions = Array.from(
        viewerRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      const first = actions[0];
      const last = actions.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleViewerKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleViewerKeyDown);
    };
  }, [activeImage]);

  const zoom = imageZoomSteps[zoomIndex];

  return (
    <>
      <div className={cn('math-markdown', className)}>
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkMath]}
          rehypePlugins={[
            [
              rehypeKatex,
              {
                strict: false,
                throwOnError: false,
                trust: false,
              },
            ],
          ]}
          components={interactiveImages
            ? {
                img({ alt = '', src }) {
                  if (!src) return null;
                  const imageAlt = alt.trim() || '题目图片';
                  return (
                    <button
                      ref={(button) => {
                        if (button && imageTriggerSourceRef.current === src) {
                          imageTriggerRef.current = button;
                        }
                      }}
                      type="button"
                      className="math-image-trigger"
                      aria-label={`放大查看${imageAlt}`}
                      onClick={(event) => {
                        imageTriggerSourceRef.current = src;
                        imageTriggerRef.current = event.currentTarget;
                        setZoomIndex(0);
                        setActiveImage({ alt: imageAlt, src });
                      }}
                    >
                      <img src={src} alt={imageAlt} />
                      <span aria-hidden="true">放大阅读</span>
                    </button>
                  );
                },
              }
            : undefined}
        >
          {normalizeModelMathDelimiters(content)}
        </ReactMarkdown>
      </div>

      {activeImage ? (
        <div
          className="math-image-viewer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeImageViewer();
          }}
        >
          <div
            ref={viewerRef}
            className="math-image-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={`题图阅读：${activeImage.alt}`}
          >
            <header>
              <div>
                <span>QUESTION IMAGE / 题图阅读</span>
                <strong>{activeImage.alt}</strong>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="math-image-viewer-close"
                aria-label="关闭题图阅读"
                onClick={closeImageViewer}
              >
                关闭
              </button>
            </header>

            <div className="math-image-viewer-toolbar" role="group" aria-label="题图缩放">
              <button
                type="button"
                aria-label="缩小题图"
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
              >
                −
              </button>
              <span aria-live="polite">
                {zoomIndex === 0 ? '适合窗口' : '放大阅读'} · {zoom}%
              </span>
              <button
                type="button"
                aria-label="放大题图"
                disabled={zoomIndex === imageZoomSteps.length - 1}
                onClick={() => setZoomIndex((current) => Math.min(imageZoomSteps.length - 1, current + 1))}
              >
                ＋
              </button>
              <button
                type="button"
                aria-label="恢复题图适合窗口"
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex(0)}
              >
                适合窗口
              </button>
            </div>

            <div className="math-image-viewer-canvas" tabIndex={0}>
              <img
                src={activeImage.src}
                alt={activeImage.alt}
                style={{ width: `${zoom}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
