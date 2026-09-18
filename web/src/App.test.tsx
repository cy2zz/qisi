import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function renderApp(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('restores an existing student from the cookie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user: { id: '7', username: '小林' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '今天想解决哪道题？' })).toBeInTheDocument();
    });
    expect(screen.getByText('小林')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('logs in with only a username', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: '8', username: '高三A班-01' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

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
    expect(fetchMock).toHaveBeenLastCalledWith(
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

  it('starts a mathematics conversation from the local fixture bank and inserts formula syntax', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input) === '/api/problems/analyze') {
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

      return Promise.resolve(
        new Response(JSON.stringify({ user: { id: '7', username: '小林' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    renderApp('/bank');

    fireEvent.click(await screen.findByRole('button', { name: '从本地题库选择' }));
    expect(screen.getByRole('dialog', { name: '本地题库' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择 F-01 导数与函数' }));
    expect(await screen.findByRole('heading', { name: '题目分析' })).toBeInTheDocument();
    expect(screen.getByText('确定单调区间与极值。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/analyze',
      expect.objectContaining({
        body: JSON.stringify({ problemMd: '已知函数 $f(x)=x^3-3x$，求 $f(x)$ 的单调区间与极值。' }),
        credentials: 'include',
        method: 'POST',
      }),
    );
    expect(screen.getByRole('heading', { name: '做题记录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '公式' }));
    fireEvent.click(screen.getByRole('button', { name: '插入分式' }));
    expect(screen.getByRole('textbox', { name: '输入题目或想法' })).toHaveValue('$\\frac{}{}$');
  });

  it('streams a checked reply for each student turn', async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
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
      return Promise.resolve(
        new Response(JSON.stringify({ user: { id: '7', username: '小林' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    renderApp('/bank');
    fireEvent.click(await screen.findByRole('button', { name: '从本地题库选择' }));
    fireEvent.click(screen.getByRole('button', { name: '选择 F-01 导数与函数' }));
    await screen.findByRole('heading', { name: '题目分析' });

    const composer = screen.getByRole('textbox', { name: '输入题目或想法' });
    fireEvent.change(composer, { target: { value: '我先求导，得到 $f\'(x)=3x^2-3$。' } });
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
