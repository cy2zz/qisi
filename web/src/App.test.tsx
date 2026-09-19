import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

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

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function bankResponse(url: string) {
  if (url === '/api/bank/filters') {
    return jsonResponse({ regions: ['北京'], tracks: ['综合'], years: [2024] });
  }
  if (url === '/api/bank/papers/41') return jsonResponse(paperDetail);
  if (url.startsWith('/api/bank/papers')) return jsonResponse({ papers: [paperSummary], total: 1 });
  return null;
}

function renderApp(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

function enterRichText(text: string) {
  const editor = screen.getByRole('textbox', { name: '输入题目或想法' });
  editor.textContent = text;
  fireEvent.input(editor);
  return editor;
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('restores an existing student from the cookie', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      jsonResponse({ user: { id: '7', username: '小林' } }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '今天想解决哪道题？' })).toBeInTheDocument();
    });
    expect(screen.getByText('小林')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '题库' })).toHaveAttribute('href', '/bank');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('logs in with only a username', async () => {
    let authChecked = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/auth/me' && !authChecked) {
        authChecked = true;
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return jsonResponse({ user: { id: '8', username: '高三A班-01' } });
    });

    renderApp();

    const input = await screen.findByLabelText('用户名');
    expect(input).toHaveAttribute('placeholder', '请输入用户名');
    expect(input).toHaveAttribute('data-slot', 'input');
    expect(screen.getByText('可以使用昵称，不必填写真实姓名。')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '高三A班-01' } });
    const submitButton = screen.getByRole('button', { name: '进入学习空间' });
    expect(submitButton).toHaveAttribute('data-slot', 'button');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '今天想解决哪道题？' })).toBeInTheDocument();
    });
    expect(screen.getByText('高三A班-01')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ username: '高三A班-01' }),
        credentials: 'include',
        method: 'POST',
      }),
    );
  });

  it('sets the login moment in a meaningful mathematics context', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined));

    const view = renderApp();

    expect(view.getByText('今日数学坐标')).toBeInTheDocument();
    expect(view.getByRole('img', { name: '函数图像与切线示意' })).toBeInTheDocument();
    expect(view.getByText('先观察，再推导')).toBeInTheDocument();
  });

  it('starts a mathematics conversation from the paper picker and inserts formula syntax', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const bankResult = bankResponse(url);
      if (bankResult) return bankResult;
      if (url === '/api/problems/analyze') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              analysis: {
                firstQuestion: '你准备先求导还是先观察函数图像？',
                keyConditions: ['函数为三次多项式'],
                knowledgePoints: ['导数', '单调性'],
                overview: '这是一道利用导数研究函数性质的题目。',
                target: '确定单调区间与极值。',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }

      return jsonResponse({ user: { id: '7', username: '小林' } });
    });

    renderApp('/study');

    fireEvent.click(await screen.findByRole('button', { name: '去题库选择' }));
    expect(screen.getByRole('dialog', { name: '从题库选择' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: '选择第 1 题' }));
    expect(await screen.findByRole('heading', { name: '题目分析' })).toBeInTheDocument();
    expect(screen.getByText('确定单调区间与极值。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/analyze',
      expect.objectContaining({
        body: JSON.stringify({
          problemMd: '![2024年高考数学试卷（北京）第 1 题](https://example.test/question.png)',
        }),
        credentials: 'include',
        method: 'POST',
      }),
    );
    expect(screen.getByRole('heading', { name: '做题记录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '公式' }));
    fireEvent.click(screen.getByRole('button', { name: '插入分式' }));
    expect(screen.getByRole('textbox', { name: '输入题目或想法' })).toHaveTextContent('$\\frac{}{}$');
  });

  it('streams a checked reply for each student turn', async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const bankResult = bankResponse(url);
      if (bankResult) return bankResult;
      if (url === '/api/problems/analyze') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              analysis: {
                firstQuestion: '你准备先求导还是先观察函数图像？',
                keyConditions: ['函数为三次多项式'],
                knowledgePoints: ['导数', '单调性'],
                overview: '这是一道利用导数研究函数性质的题目。',
                target: '确定单调区间与极值。',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url === '/api/problems/chat') {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
                controller.enqueue(
                  encoder.encode('event: status\ndata: {"message":"正在核对你的这一步"}\n\n'),
                );
              },
            }),
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          ),
        );
      }
      return jsonResponse({ user: { id: '7', username: '小林' } });
    });

    renderApp('/study');
    fireEvent.click(await screen.findByRole('button', { name: '去题库选择' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择第 1 题' }));
    await screen.findByRole('heading', { name: '题目分析' });

    enterRichText('我先求导，得到 $f\'(x)=3x^2-3$。');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('正在核对你的这一步')).toBeInTheDocument();
    await act(async () => {
      streamController?.enqueue(
        encoder.encode('event: chunk\ndata: {"text":"下一步看导函数的"}\n\n'),
      );
    });
    expect(await screen.findByText('下一步看导函数的')).toBeInTheDocument();

    await act(async () => {
      streamController?.enqueue(
        encoder.encode('event: chunk\ndata: {"text":"正负区间。"}\n\nevent: done\ndata: {}\n\n'),
      );
      streamController?.close();
    });
    expect(await screen.findByText('下一步看导函数的正负区间。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/chat',
      expect.objectContaining({
        body: expect.stringContaining('我先求导'),
        method: 'POST',
      }),
    );
  });
});
