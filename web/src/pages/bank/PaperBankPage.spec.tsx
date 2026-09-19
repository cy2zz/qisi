import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaperBankPage } from './PaperBankPage';

const filters = { regions: ['上海', '北京', '全国甲卷'], tracks: ['文科', '综合'], years: [2025, 2024] };
const papers = {
  papers: [
    {
      examType: '高考',
      examYear: 2024,
      id: '41',
      introImageUrl: 'https://example.test/intro.png',
      isOfficial: true,
      questionCount: 2,
      region: '北京',
      session: null,
      status: 'ready',
      subject: '数学',
      title: '2024年高考数学试卷（北京）',
      track: '综合',
      variant: '题目与解析',
    },
  ],
  total: 1,
};
const paper = {
  ...papers.papers[0],
  questions: [
    {
      id: '801',
      imageHeight: 425,
      imageWidth: 1600,
      number: 1,
      questionCode: '2024年高考数学试卷（北京）#01',
      questionImageUrl: 'https://example.test/question.png',
      statementMarkdown: null,
      status: 'ready',
    },
  ],
};

function renderPage(initialEntry = '/bank') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/bank" element={<PaperBankPage username="小林" />} />
        <Route
          path="/bank/papers/:paperId/questions/:questionId"
          element={<PaperBankPage username="小林" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function mockBankApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const body = url.includes('/api/bank/filters')
      ? filters
      : url.includes('/api/bank/papers/41')
        ? paper
        : papers;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

describe('PaperBankPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('filters papers and previews question images without exposing analysis', async () => {
    const fetchMock = mockBankApi();
    renderPage();

    expect(screen.getByRole('navigation', { name: '学习导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '题库' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '当前对话' })).toHaveAttribute('href', '/study');
    expect(await screen.findByRole('heading', { name: '从题库选择' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '历年真题，按卷选题' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '题库选择工作区' })).toHaveClass(
      'paper-bank-workspace',
    );
    expect(screen.getByLabelText('筛选试卷')).toHaveClass('paper-picker-filters');
    expect(screen.getByRole('complementary', { name: '试卷列表' })).toHaveClass(
      'paper-picker-papers',
    );
    const paperContent = await screen.findByRole('region', { name: '试卷内容' });
    expect(paperContent).toHaveClass('paper-picker-questions');
    expect(await within(paperContent).findAllByRole('article')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: '选择题号' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择第 1 题' })).toHaveTextContent('选择');
    expect(await screen.findByRole('img', { name: '第 1 题题目' })).toHaveAttribute(
      'src',
      'https://example.test/question.png',
    );
    expect(document.body.textContent).not.toContain('解析图片');
    expect(document.body.innerHTML).not.toContain('analysis');

    fireEvent.change(screen.getByLabelText('年份'), { target: { value: '2024' } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bank/papers?year=2024',
        expect.objectContaining({ credentials: 'include' }),
      );
    });
  });

  it('keeps the selected paper and question in the URL-backed page state', async () => {
    mockBankApi();
    renderPage();

    await screen.findByRole('img', { name: '第 1 题题目' });
    fireEvent.click(screen.getByRole('button', { name: '选择第 1 题' }));

    expect(await screen.findByRole('button', { name: '已选择第 1 题' })).toBeDisabled();
  });

  it('shows a retryable API error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取题库');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});
