import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaperPickerDialog } from './PaperPickerDialog';

const filters = {
  regions: ['北京'],
  tracks: ['综合'],
  years: [2024],
};

const paperSummary = {
  examType: '高考',
  examYear: 2024,
  id: '41',
  introImageUrl: null,
  isOfficial: true,
  questionCount: 1,
  region: '北京',
  session: null,
  status: 'ready',
  subject: '数学',
  title: '2024年高考数学试卷（北京）',
  track: '综合',
  variant: '题目与解析',
};

const paperDetail = {
  ...paperSummary,
  questions: [
    {
      id: '801',
      imageHeight: 425,
      imageWidth: 1600,
      number: 1,
      questionCode: '2024北京#01',
      questionImageUrl: 'https://example.test/question.png',
      statementMarkdown: null,
      status: 'ready',
    },
  ],
};

const scope = {
  bankVersion: 'exam-bank@2026-09-20T00:00:00.000Z',
  invalidCount: 0,
  needsReviewCount: 0,
  paperCount: 1,
  readyCount: 1,
  selectableCount: 1,
  totalCount: 1,
  unreadableCount: 0,
  updatedAt: '2026-09-20T00:00:00.000Z',
};

describe('PaperPickerDialog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads the real paper bank and returns a question without exposing analysis', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const body = url === '/api/bank/filters'
        ? filters
        : url === '/api/bank/questions/random'
          ? {
              requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
              scope,
              selection: { paper: paperSummary, question: paperDetail.questions[0] },
            }
        : url === '/api/bank/papers/41'
          ? paperDetail
          : { papers: [paperSummary], scope, total: 1 };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    const onSelect = vi.fn();

    render(<PaperPickerDialog open onClose={vi.fn()} onSelect={onSelect} />);

    expect(await screen.findByRole('dialog', { name: '从题库选择' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭题库' })).toHaveFocus();
    const paperContent = await screen.findByRole('region', { name: '试卷内容' });
    expect(await within(paperContent).findAllByRole('article')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: '选择第 1 题' })).toBeInTheDocument();
    const questionImage = screen.getByRole('img', { name: '第 1 题题目' });
    expect(questionImage).toHaveAttribute(
      'src',
      'https://example.test/question.png',
    );
    expect(document.body.innerHTML).not.toContain('analysisImage');

    fireEvent.load(questionImage);
    fireEvent.click(screen.getByRole('button', { name: '选择第 1 题' }));

    expect(onSelect).toHaveBeenCalledWith({ paper: paperSummary, question: paperDetail.questions[0] });
  });

  it('closes with Escape', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined));
    const onClose = vi.fn();

    render(<PaperPickerDialog open onClose={onClose} onSelect={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps a random result in the picker until the student confirms it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const body = url === '/api/bank/filters'
        ? filters
        : url === '/api/bank/questions/random'
          ? {
              requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
              scope,
              selection: { paper: paperSummary, question: paperDetail.questions[0] },
            }
          : url === '/api/bank/papers/41'
            ? paperDetail
            : { papers: [paperSummary], scope, total: 1 };
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    const onSelect = vi.fn();
    render(<PaperPickerDialog open onClose={vi.fn()} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole('button', { name: '随机抽一道' }));

    const question = await screen.findByRole('article', { name: '第 1 题' });
    expect(question).toHaveAttribute('data-random-target', 'true');
    expect(question).toHaveTextContent('随机抽中');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus inside the dialog and restores the opener', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const body = url === '/api/bank/filters'
        ? filters
        : url === '/api/bank/papers/41'
          ? paperDetail
          : { papers: [paperSummary], total: 1 };
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    const opener = document.createElement('button');
    opener.textContent = '打开题库';
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const view = render(<PaperPickerDialog open onClose={onClose} onSelect={vi.fn()} />);

    const close = screen.getByRole('button', { name: '关闭题库' });
    expect(close).toHaveFocus();
    const questionImage = await screen.findByRole('img', { name: '第 1 题题目' });
    fireEvent.load(questionImage);
    const select = screen.getByRole('button', { name: '选择第 1 题' });
    const dialog = screen.getByRole('dialog', { name: '从题库选择' });
    expect(dialog).toContainElement(select);
    expect(select).toBeEnabled();
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, input, select, a[href], [tabindex]',
    )).filter((element) => !element.matches(':disabled, [tabindex="-1"]'));
    expect(focusable.at(-1)).toBe(select);
    close.focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(select).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    view.rerender(<PaperPickerDialog open={false} onClose={onClose} onSelect={vi.fn()} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('renders a text-only question as mathematical Markdown', async () => {
    const textQuestion = {
      ...paperDetail.questions[0],
      id: '802',
      number: 2,
      questionCode: '2024北京#02',
      questionImageUrl: null,
      statementMarkdown: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$。`,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const body = url === '/api/bank/filters'
        ? filters
        : url === '/api/bank/papers/41'
          ? { ...paperDetail, questions: [textQuestion] }
          : { papers: [paperSummary], total: 1 };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    render(<PaperPickerDialog open onClose={vi.fn()} onSelect={vi.fn()} />);

    const question = await screen.findByRole('article', { name: '第 2 题' });
    expect(question.querySelector('.katex')).not.toBeNull();
    expect(question).not.toHaveTextContent(String.raw`$\frac{\sqrt{2}}{\sqrt{3}}$`);
  });
});
