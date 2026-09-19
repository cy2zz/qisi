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
        : url === '/api/bank/papers/41'
          ? paperDetail
          : { papers: [paperSummary], total: 1 };

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
    expect(screen.getByRole('img', { name: '第 1 题题目' })).toHaveAttribute(
      'src',
      'https://example.test/question.png',
    );
    expect(document.body.innerHTML).not.toContain('analysisImage');

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
});
