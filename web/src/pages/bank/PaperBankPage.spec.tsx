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
  scope: {
    bankVersion: 'exam-bank@2026-09-20T00:00:00.000Z',
    invalidCount: 0,
    needsReviewCount: 2,
    paperCount: 1,
    readyCount: 12,
    selectableCount: 12,
    totalCount: 14,
    unreadableCount: 0,
    updatedAt: '2026-09-20T00:00:00.000Z',
  },
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
      questionImageUrl: 'https://example.test/question.png' as string | null,
      statementMarkdown: null as string | null,
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

function mockBankApi(paperDetail = paper) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const body = url.includes('/api/bank/filters')
      ? filters
      : url.includes('/api/bank/questions/random')
        ? {
            requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
            scope: papers.scope,
            selection: { paper: papers.papers[0], question: paperDetail.questions[0] },
          }
      : url.includes('/api/bank/papers/41')
        ? paperDetail
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
    const questionImage = await screen.findByRole('img', { name: '第 1 题题目' });
    expect(questionImage).toHaveAttribute(
      'src',
      'https://example.test/question.png',
    );
    expect(screen.getByRole('button', { name: '选择第 1 题' })).toBeDisabled();
    fireEvent.load(questionImage);
    expect(screen.getByRole('button', { name: '选择第 1 题' })).toHaveTextContent('选择');
    expect(screen.getByRole('button', { name: '选择第 1 题' })).toBeEnabled();
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

    fireEvent.load(await screen.findByRole('img', { name: '第 1 题题目' }));
    fireEvent.click(screen.getByRole('button', { name: '选择第 1 题' }));

    expect(await screen.findByRole('button', { name: '已选择第 1 题' })).toBeDisabled();
  });

  it('draws from the visible scope and waits for the student to confirm the question', async () => {
    const fetchMock = mockBankApi();
    renderPage();

    const scope = await screen.findByRole('region', { name: '当前抽题范围' });
    expect(scope).toHaveTextContent('全部试卷');
    expect(scope).toHaveTextContent('12 道可练习题');

    fireEvent.click(screen.getByRole('button', { name: '随机抽一道' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bank/questions/random',
        expect.objectContaining({
          body: expect.stringContaining('"filters":{}'),
          credentials: 'include',
          method: 'POST',
        }),
      );
    });
    const question = await screen.findByRole('article', { name: '第 1 题' });
    expect(question).toHaveAttribute('data-random-target', 'true');
    expect(question).toHaveTextContent('随机抽中');
    expect(screen.getByRole('button', { name: '选择第 1 题' })).not.toHaveTextContent('已选择');
  });

  it('renders a text-only question as mathematical Markdown', async () => {
    mockBankApi({
      ...paper,
      questions: [{
        ...paper.questions[0],
        id: '802',
        number: 2,
        questionCode: '2024年高考数学试卷（北京）#02',
        questionImageUrl: null,
        statementMarkdown: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$。`,
      }],
    });
    renderPage();

    const question = await screen.findByRole('article', { name: '第 2 题' });
    expect(question.querySelector('.katex')).not.toBeNull();
    expect(question).not.toHaveTextContent(String.raw`$\frac{\sqrt{2}}{\sqrt{3}}$`);
  });

  it('shows a retryable API error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取题库');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});
