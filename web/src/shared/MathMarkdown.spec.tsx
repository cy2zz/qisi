import { describe, expect, it } from 'vitest';
import { normalizeModelMathDelimiters } from './MathMarkdown';

describe('normalizeModelMathDelimiters', () => {
  it('keeps interval parentheses inside display math instead of nesting dollar delimiters', () => {
    const result = normalizeModelMathDelimiters(
      String.raw`区间为 \[(-\infty,-1)\cup(1,\infty)\]。`,
    );

    expect(result).toBe(String.raw`区间为

$$
(-\infty,-1)\cup(1,\infty)
$$

。`);
    expect(result).not.toContain(String.raw`$-\infty`);
  });
});
