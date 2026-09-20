const knownMathCommands =
  'begin|cdot|cos|d?frac|div|geq|infty|int|left|leq|lim|ln|log|mathbb|neq|overline|parallel|perp|pm|prod|right|sin|sqrt|sum|tan|text|times|underline|vec';

const bracketMathPattern = new RegExp(
  `([ \\t]*)(\\\\?)\\[\\s*((?=[^\\]]*\\\\(?:${knownMathCommands})(?![A-Za-z]))[^\\]]+?)\\s*(\\\\?)\\]`,
  'g',
);
const bareParenthesizedMathPattern = new RegExp(
  `\\(\\s*((?=[^)\\n]*\\\\(?:${knownMathCommands}))[^)\\n]+?)\\s*\\)`,
  'g',
);
const doubleEscapedMathPattern = new RegExp(
  `\\\\\\\\(?=(?:\\[|]|\\(|\\)|(?:${knownMathCommands})(?![A-Za-z])))`,
  'g',
);
const codeSegmentPattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const protectedMarkdownSegmentPattern =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g;

/**
 * Repairs common model delimiter drift at the trusted rendering boundary.
 *
 * The UI parser intentionally accepts dollar-delimited math only. Models may
 * still emit `\(...\)`, `\[...\]`, or lose the delimiter backslashes while
 * retaining LaTeX commands. Repair only segments that contain a known math
 * command, and never rewrite fenced or inline code.
 */
export function normalizeRenderedMathMarkdown(content: string): string {
  const canonicalDelimiters = content
    .split(codeSegmentPattern)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      return segment
        .replace(doubleEscapedMathPattern, '\\')
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
        .replace(
          bareParenthesizedMathPattern,
          (_match, math: string) => `$${math.trim()}$`,
        );
    })
    .join('');
}
