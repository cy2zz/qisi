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

  it('restores the latest persisted problem, checked messages, and help exposure after refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/auth/me') {
        return jsonResponse({ user: { id: '7', username: '小林' } });
      }
      if (url === '/api/learning/sessions') {
        return jsonResponse({
          sessions: [{
            content: '化简 $\\frac{\\sqrt2}{\\sqrt3}$。',
            id: '91',
            problemMd: '化简 $\\frac{\\sqrt2}{\\sqrt3}$。',
            title: '根式化简',
            topic: '二次根式',
            updatedAt: '2026-09-19T09:00:00.000Z',
            version: 2,
          }],
        });
      }
      if (url === '/api/learning/sessions/91') {
        return jsonResponse({
          analysis: {
            firstQuestion: '分母乘什么会成为整数？',
            keyConditions: ['$\\sqrt3$ 在分母'],
            knowledgePoints: ['分母有理化'],
            overview: '这是一道根式化简题。',
            target: '使分母不含根号。',
          },
          messages: [
            {
              content: '这是一道根式化简题。',
              id: '1',
              messageType: 'analysis',
              role: 'guide',
            },
            {
              content: '我还不确定',
              id: '2',
              messageType: 'student_attempt',
              role: 'student',
            },
            {
              assistanceMode: 'hint',
              content: '想一想 $\\sqrt3\\times\\sqrt3$ 等于多少。',
              id: '3',
              messageType: 'guide_reply',
              role: 'guide',
            },
          ],
          record: {
            content: '化简 $\\frac{\\sqrt2}{\\sqrt3}$。',
            id: '91',
            problemMd: '化简 $\\frac{\\sqrt2}{\\sqrt3}$。',
            title: '根式化简',
            topic: '二次根式',
            version: 2,
          },
        });
      }
      return jsonResponse({});
    });

    renderApp('/study');

    expect(await screen.findByRole('heading', { name: '根式化简' })).toBeInTheDocument();
    expect(screen.getByText('我还不确定')).toBeInTheDocument();
    expect(screen.getByLabelText('帮助深度：最小提示')).toBeInTheDocument();
    expect(screen.getByText('已保存，可刷新继续')).toBeInTheDocument();
    expect(document.querySelectorAll('.chat-message-guide .katex')).not.toHaveLength(0);
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
                firstQuestion: '如何化简 $\\frac{\\sqrt{2}}{\\sqrt{3}}$？',
                keyConditions: ['原式为 $\\frac{\\sqrt{2}}{\\sqrt{3}}$'],
                knowledgePoints: ['导数', '单调性'],
                overview: '这是一道根式化简题。',
                target: '求出 $\\frac{\\sqrt{6}}{3}$。',
              },
              problemMd: '已知 $\\frac{\\sqrt{2}}{\\sqrt{3}}$，请化简。',
              recognitionUncertain: ['根号范围待核对'],
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
    expect(screen.getByRole('complementary', { name: '题目原文' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '先做一步' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '快捷回应' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '学习帮助' })).not.toBeInTheDocument();
    expect(screen.getByText('题面识别有待核对')).toBeInTheDocument();
    expect(screen.getByText('根号范围待核对')).toBeInTheDocument();
    expect(document.querySelectorAll('.problem-analysis .katex')).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/analyze',
      expect.objectContaining({
        body: expect.stringContaining('"questionId":"801"'),
        credentials: 'include',
        method: 'POST',
      }),
    );
    expect(screen.getByRole('heading', { name: '做题记录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '公式' }));
    fireEvent.click(screen.getByRole('button', { name: '插入分式' }));
    expect(screen.getByRole('textbox', { name: '输入题目或想法' })).toHaveTextContent('$\\frac{}{}$');
  });

  it('returns focus to the composer after the initial analysis finishes', async () => {
    let resolveAnalysis: ((response: Response) => void) | undefined;
    const pendingAnalysis = new Promise<Response>((resolve) => {
      resolveAnalysis = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const bankResult = bankResponse(url);
      if (bankResult) return bankResult;
      if (url === '/api/problems/analyze') return pendingAnalysis;
      return jsonResponse({ user: { id: '7', username: '小林' } });
    });

    renderApp('/study');
    fireEvent.click(await screen.findByRole('button', { name: '去题库选择' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择第 1 题' }));

    const editor = screen.getByRole('textbox', { name: '输入题目或想法' });
    await waitFor(() => expect(editor).toHaveFocus());
    screen.getByRole('button', { name: '开始新题' }).focus();
    expect(editor).not.toHaveFocus();

    await act(async () => {
      resolveAnalysis?.(
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
    });

    await screen.findByRole('heading', { name: '题目分析' });
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it('replaces a temporary LaTeX-derived title with the persisted analysis title', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/problems/analyze') {
        return jsonResponse({
          analysis: {
            firstQuestion: '分母怎样有理化？',
            keyConditions: ['$\\sqrt{3}$ 在分母'],
            knowledgePoints: ['二次根式', '分母有理化'],
            overview: '这是一道二次根式化简题。',
            target: '化简原式。',
          },
          session: { id: '91', title: '二次根式化简题', version: 1 },
        });
      }
      return jsonResponse({ user: { id: '7', username: '小林' } });
    });

    renderApp('/study');
    await screen.findByRole('heading', { name: '今天想解决哪道题？' });
    const editor = screen.getByRole('textbox', { name: '输入题目或想法' });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
        items: [],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByRole('heading', { name: '二次根式化简题' })).toBeInTheDocument();
    expect(screen.queryByText(/fracsqrt/i)).not.toBeInTheDocument();
  });

  it('recognizes an attached question image and starts the same analysis flow', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/media/recognize-question') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              image: { height: 900, width: 1200 },
              recognition: {
                answerMarkdown: '$x=2$',
                questionType: '函数题',
                stemMarkdown: '已知函数 $f(x)=x^2$，求最小值。',
                uncertain: [],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url === '/api/problems/analyze') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              analysis: {
                firstQuestion: '你准备先观察哪个条件？',
                keyConditions: ['$f(x)=x^2$'],
                knowledgePoints: ['函数'],
                overview: '这是一道函数最值题。',
                target: '求函数最小值。',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return jsonResponse({ user: { id: '7', username: '小林' } });
    });

    renderApp('/study');
    await screen.findByRole('heading', { name: '今天想解决哪道题？' });
    const file = new File(['image'], 'question.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('选择题目图片'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '识别并开始分析' }));

    expect(await screen.findByRole('heading', { name: '题目分析' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/media/recognize-question',
      expect.objectContaining({ body: file, method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/analyze',
      expect.objectContaining({
        body: expect.stringContaining('图片中可见答案或解答'),
        method: 'POST',
      }),
    );
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
              problemMd: '已知函数 $f(x)=x^3-3x$，求单调区间与极值。',
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

    expect(screen.getByRole('group', { name: '快捷回应' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我来写' }));
    expect(screen.getByRole('textbox', { name: '输入题目或想法' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '我还不确定' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提示一点' }));

    expect(await screen.findByText('正在核对你的这一步')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '快捷回应' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '学习帮助' })).toBeInTheDocument();
    const formulaReply = String.raw`有依据：试着把 [ \frac{\sqrt{2}}{\sqrt{3}} ] 的分子分母同时乘以 (\sqrt{3})：[ \frac{\sqrt{2}}{\sqrt{3}}\times\frac{\sqrt{3}}{\sqrt{3}} ]。`;
    await act(async () => {
      streamController?.enqueue(
        encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: formulaReply })}\n\n`),
      );
    });
    await waitFor(() => {
      expect(document.querySelectorAll('.streaming-reply .katex')).toHaveLength(3);
    });
    expect(screen.getByText('最小提示')).toBeInTheDocument();

    await act(async () => {
      streamController?.enqueue(
        encoder.encode('event: chunk\ndata: {"text":"你先算一下。"}\n\nevent: done\ndata: {}\n\n'),
      );
      streamController?.close();
    });
    expect(await screen.findByText(/你先算一下/)).toBeInTheDocument();
    expect(document.querySelectorAll('.chat-message-guide .katex')).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/chat',
      expect.objectContaining({
        body: expect.stringContaining('"assistanceMode":"hint"'),
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/chat',
      expect.objectContaining({
        body: expect.stringContaining('已知函数 $f(x)=x^3-3x$，求单调区间与极值。'),
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems/chat',
      expect.objectContaining({
        body: expect.stringContaining('不要替我计算或给出答案'),
        method: 'POST',
      }),
    );
  });
});
