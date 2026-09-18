import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';

interface MathMarkdownProps {
  className?: string;
  content: string;
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
