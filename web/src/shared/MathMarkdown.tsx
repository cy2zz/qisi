import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';

interface MathMarkdownProps {
  className?: string;
  content: string;
}

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

export function MathMarkdown({ className, content }: MathMarkdownProps) {
  return (
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
      >
        {normalizeModelMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}
