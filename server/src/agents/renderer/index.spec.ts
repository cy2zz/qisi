import { describe, expect, it, vi } from 'vitest';
import type { ModelPort } from '../../model/ports.js';
import { Renderer } from './index.js';

const rendererInput = {
  action: 'hint',
  approved_facts: [],
  expected_student_artifact: '写出分子和分母分别变成什么。',
  intervention: 'minimal_hint',
  public_history_md: [],
  public_prompt_md: '化简根式分式。',
  question_md: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$',
  scaffold_level: 1,
  task_id: 'task-1',
};

function createModel(textMd: string): ModelPort {
  return {
    generate: vi.fn().mockResolvedValue({
      elapsedMs: 10,
      model: 'fixture-model',
      parsed: { text_md: textMd },
      provider: 'fixture',
      usage: { input: 10, kind: 'reported', output: 8 },
    }),
  };
}

describe('Renderer', () => {
  it('normalizes dropped math delimiters before the reply reaches Guard or persistence', async () => {
    const renderer = new Renderer();
    const model = createModel(String.raw`试着把 [ \frac{\sqrt{2}}{\sqrt{3}} ] 的分子分母同时乘以 (\sqrt{3})。`);

    const result = await renderer.run(rendererInput, model, {
      model: 'fixture-model',
      signal: AbortSignal.timeout(1_000),
    });

    expect(result.value.text_md).toBe(
      String.raw`试着把 $\frac{\sqrt{2}}{\sqrt{3}}$ 的分子分母同时乘以 $\sqrt{3}$。`,
    );
  });

  it('does not wrap interval parentheses again inside a normalized display formula', async () => {
    const renderer = new Renderer();
    const model = createModel(String.raw`区间为 \[(-\infty,-1)\cup(1,\infty)\]。`);

    const result = await renderer.run(rendererInput, model, {
      model: 'fixture-model',
      signal: AbortSignal.timeout(1_000),
    });

    expect(result.value.text_md).toBe(
      String.raw`区间为

$$
(-\infty,-1)\cup(1,\infty)
$$

。`,
    );
    expect(result.value.text_md).not.toContain(String.raw`$-\infty`);
  });

  it('normalizes asymmetric and multiline bracket delimiters', async () => {
    const renderer = new Renderer();
    const model = createModel(String.raw`试着把 \[ \frac{\sqrt2}{\sqrt3} ] 的分子分母同时乘以 (\sqrt3)：[ \frac{\sqrt2}{\sqrt3}\times
\frac{\sqrt3}{\sqrt3} \]`);

    const result = await renderer.run(rendererInput, model, {
      model: 'fixture-model',
      signal: AbortSignal.timeout(1_000),
    });

    expect(result.value.text_md).toBe(String.raw`试着把 $\frac{\sqrt2}{\sqrt3}$ 的分子分母同时乘以 $\sqrt3$：

$$
\frac{\sqrt2}{\sqrt3}\times
\frac{\sqrt3}{\sqrt3}
$$

`);
  });
});
