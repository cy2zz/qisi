import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';

interface MathMarkdownProps {
  className?: string;
  content: string;
}

const bareBracketMathPattern =
  /\[\s*((?=[^\]\n]*\\(?:begin|cdot|cos|d?frac|div|geq|infty|int|left|leq|lim|ln|log|mathbb|neq|overline|parallel|perp|pm|prod|right|sin|sqrt|sum|tan|text|times|underline|vec))[^\]\n]+?)\s*\]/g;
const bareParenthesizedMathPattern =
  /\(\s*((?=[^)\n]*\\(?:begin|cdot|cos|d?frac|div|geq|infty|int|left|leq|lim|ln|log|mathbb|neq|overline|parallel|perp|pm|prod|right|sin|sqrt|sum|tan|text|times|underline|vec))[^)\n]+?)\s*\)/g;
const doubleEscapedMathPattern =
  /\\\\(?=(?:\[|]|\(|\)|(?:begin|cdot|cos|d?frac|div|geq|infty|int|left|leq|lim|ln|log|mathbb|neq|overline|parallel|perp|pm|prod|right|sin|sqrt|sum|tan|text|times|underline|vec)(?![A-Za-z])))/g;

function normalizeModelMathDelimiters(content: string) {
  return content
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      return segment
        // A model may JSON-escape an already escaped formula, leaving two
        // literal backslashes after transport decoding. Collapse only known
        // math delimiters and commands; keep intentional LaTeX line breaks.
        .replace(doubleEscapedMathPattern, '\\')
        .replace(/\\\[/g, () => '\n\n$$\n')
        .replace(/\\\]/g, () => '\n$$\n\n')
        .replace(/\\\(/g, () => '$')
        .replace(/\\\)/g, () => '$')
        // The same delimiter loss can leave an inline formula looking like
        // `(\sqrt3)`. Only repair parentheses containing a known command.
        .replace(bareParenthesizedMathPattern, (_match, math: string) => `$${math.trim()}$`)
        // Some JSON-producing models drop the backslashes from \[...\] while
        // retaining the LaTeX commands inside. Treat only bracketed content
        // containing a known math command as formula text, so ordinary Chinese
        // square brackets and Markdown links keep their original meaning.
        .replace(bareBracketMathPattern, (_match, math: string) => `$${math.trim()}$`);
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
