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

  it('restores structured checked verdicts and keeps incorrect work out of independent assessment', async () => {
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
            {
              content: '结果是 $\\frac23$。',
              id: '4',
              messageType: 'student_attempt',
              role: 'student',
            },
            {
              assistanceMode: 'finish_problem',
              content: '这次结论需要修正，请检查分子。',
              id: '5',
              messageType: 'guide_reply',
              metadata: { currentVerdict: 'incorrect' },
              role: 'guide',
            },
            {
              content: '请解释我为什么不能直接把根号去掉。',
              id: '6',
              messageType: 'student_attempt',
              role: 'student',
            },
            {
              assistanceMode: 'explain',
              content: '平方根不是可以直接约掉的公因式。',
              id: '7',
              messageType: 'guide_reply',
              role: 'guide',
            },
            {
              content: '分子分母同乘 $\\sqrt3$，结果为 $\\frac{\\sqrt6}{3}$。',
              id: '8',
              messageType: 'student_attempt',
              role: 'student',
            },
            {
              assistanceMode: 'finish_problem',
              content: '这次结论有依据。',
              id: '9',
              messageType: 'guide_reply',
              metadata: { currentVerdict: 'correct' },
              role: 'guide',
            },
          ],
          record: {
            content: '化简 $\\frac{\\sqrt2}{\\sqrt3}$。',
            id: '91',
            preparationStatus: 'ready',
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
    expect(screen.getByText('原卷解析已核对')).toBeInTheDocument();
    const incorrectCheckpoint = screen
      .getByText('这次结论还需要修正')
      .closest('[role="note"]');
    expect(incorrectCheckpoint).not.toBeNull();
    expect(incorrectCheckpoint?.querySelector('a')).toBeNull();
    expect(incorrectCheckpoint?.querySelector('button')).toBeNull();
    expect(incorrectCheckpoint).toHaveTextContent('已由后续作答更新');
    expect(incorrectCheckpoint).toHaveTextContent('帮助记录已使用：最小提示');
    expect(incorrectCheckpoint).not.toHaveTextContent('局部解释');
    const correctCheckpoint = screen
      .getByText('这次结论已经核对')
      .closest('[role="note"]');
    expect(correctCheckpoint).toHaveTextContent('帮助记录已使用：最小提示、局部解释');
    expect(screen.getAllByRole('link', { name: /独立检验/ })).toHaveLength(1);
    expect(document.querySelectorAll('.chat-message-guide .katex')).not.toHaveLength(0);
  });

  it('restores and automatically saves the current learning draft', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/auth/me') {
        return jsonResponse({ user: { id: '7', username: '小林' } });
      }
      if (url === '/api/learning/sessions') {
        return jsonResponse({
          sessions: [{
            content: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            id: '91',
            problemMd: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            title: '基本不等式证明',
            topic: '不等式',
            updatedAt: '2026-09-20T00:00:00.000Z',
            version: 1,
          }],
        });
      }
      if (url === '/api/learning/sessions/91') {
        return jsonResponse({
          analysis: {
            firstQuestion: '移项后能否写成一个平方？',
            keyConditions: ['$a,b$ 为实数'],
            knowledgePoints: ['基本不等式'],
            overview: '这是一道不等式证明题。',
            target: '证明不等式恒成立。',
          },
          draftMarkdown: '我准备先移项，再配成 $(a-b)^2$。',
          messages: [{
            content: '这是一道不等式证明题。',
            id: '1',
            messageType: 'analysis',
            role: 'guide',
          }],
          record: {
            content: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            id: '91',
            problemMd: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            title: '基本不等式证明',
            topic: '不等式',
            version: 1,
          },
        });
      }
      if (url === '/api/learning/sessions/91/draft') {
        return jsonResponse({ savedAt: '2026-09-20T00:00:01.000Z' });
      }
      return jsonResponse({});
    });

    renderApp('/study?session=91');

    const editor = await screen.findByRole('textbox', { name: '输入题目或想法' });
    await waitFor(() => {
      expect(editor).toHaveTextContent('我准备先移项，再配成 $(a-b)^2$。');
    });
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('已自动保存');

    editor.textContent = '我准备先移项，得到 $a^2-2ab+b^2$。';
    fireEvent.input(editor);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/learning/sessions/91/draft',
        expect.objectContaining({
          body: JSON.stringify({ markdown: '我准备先移项，得到 $a^2-2ab+b^2$。' }),
          credentials: 'include',
          method: 'PATCH',
        }),
      );
    });
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('已自动保存');
  });

  it('keeps handwriting out of teaching until its confirmed revision is submitted', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:handwriting-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const chatBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/auth/me') {
        return jsonResponse({ user: { id: '7', username: '小林' } });
      }
      if (url === '/api/learning/sessions') {
        return jsonResponse({
          sessions: [{
            content: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            id: '91',
            problemMd: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            title: '基本不等式证明',
            topic: '不等式',
            updatedAt: '2026-09-20T00:00:00.000Z',
            version: 1,
          }],
        });
      }
      if (url === '/api/learning/sessions/91') {
        return jsonResponse({
          analysis: {
            firstQuestion: '移项后能否写成一个平方？',
            keyConditions: ['$a,b$ 为实数'],
            knowledgePoints: ['基本不等式'],
            overview: '这是一道不等式证明题。',
            target: '证明不等式恒成立。',
          },
          messages: [{
            content: '这是一道不等式证明题。',
            id: '1',
            messageType: 'analysis',
            role: 'guide',
          }],
          record: {
            content: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            id: '91',
            problemMd: String.raw`证明 $a^2+b^2\geq 2ab$。`,
            title: '基本不等式证明',
            topic: '不等式',
            version: 1,
          },
        });
      }
      if (url === '/api/media/handwriting?sessionId=91') {
        return jsonResponse({
          image: { height: 800, mediaId: '31', url: '/api/media/31', width: 1200 },
          transcript: {
            confirmed: false,
            id: '41',
            lines: [
              { explicitly_confirmed: false, index: 1, text: '$a^2-2ab+b^2$', uncertain: false },
              { explicitly_confirmed: false, index: 2, text: '$=(a-b)^2\\geq 0$', uncertain: true },
            ],
            media_id: '31',
            revision: 1,
          },
        });
      }
      if (url === '/api/media/transcripts/41/confirm') {
        return jsonResponse({
          confirmed: true,
          id: '41',
          lines: [
            { explicitly_confirmed: false, index: 1, text: '$a^2-2ab+b^2$', uncertain: false },
            { explicitly_confirmed: true, index: 2, text: '$=(a-b)^2\\geq 0$', uncertain: true },
          ],
          media_id: '31',
          revision: 2,
        });
      }
      if (url === '/api/problems/chat') {
        chatBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Promise.resolve(new Response([
          'event: chunk',
          'data: {"text":"先说明这一步使用了完全平方。"}',
          '',
          'event: done',
          'data: {"version":2}',
          '',
          '',
        ].join('\n'), {
          headers: { 'Content-Type': 'text/event-stream' },
          status: 200,
        }));
      }
      return jsonResponse({});
    });

    renderApp('/study?session=91');

    await screen.findByRole('heading', { name: '基本不等式证明' });
    expect(screen.getByRole('button', { name: '添加手写作答' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加题目图片' })).not.toBeInTheDocument();

    const image = new File([new Uint8Array([1, 2, 3])], 'proof.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('选择手写作答图片'), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByRole('button', { name: '识别手写作答' }));

    const confirmTranscript = await screen.findByRole('button', {
      name: '确认转写并放入输入框',
    });
    expect(confirmTranscript).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '确认第 2 行' }));
    fireEvent.click(confirmTranscript);

    const editor = screen.getByRole('textbox', { name: '输入题目或想法' });
    await waitFor(() => {
      expect(editor).toHaveTextContent('$a^2-2ab+b^2$');
      expect(screen.getByText('手写转写已确认；如果继续修改，将按普通文字提交。')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      message: '$a^2-2ab+b^2$\n\n$=(a-b)^2\\geq 0$',
      transcriptId: '41',
      transcriptRevision: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/media/handwriting?sessionId=91',
      expect.objectContaining({ body: image, method: 'POST' }),
    );

    await screen.findByText('先说明这一步使用了完全平方。');
    fireEvent.change(screen.getByLabelText('选择手写作答图片'), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByRole('button', { name: '识别手写作答' }));
    const secondConfirm = await screen.findByRole('button', {
      name: '确认转写并放入输入框',
    });
    fireEvent.click(screen.getByRole('button', { name: '确认第 2 行' }));
    fireEvent.click(secondConfirm);
    await waitFor(() => expect(editor).toHaveTextContent('$a^2-2ab+b^2$'));

    editor.textContent = '$a^2-2ab+b^2$\n\n$=(a-b)^2\\geq 0$\n\n我补充说明这是配方法。';
    fireEvent.input(editor);
    expect(screen.queryByText('手写转写已确认；如果继续修改，将按普通文字提交。')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(chatBodies).toHaveLength(2));
    expect(chatBodies[1]).not.toHaveProperty('transcriptId');
    expect(chatBodies[1]).not.toHaveProperty('transcriptRevision');
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
              preparation: { cached: false, status: 'needs_review' },
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

    fireEvent.load(await screen.findByRole('img', { name: '第 1 题题目' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择第 1 题' }));
    expect(await screen.findByRole('heading', { name: '题目分析' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '题目原文' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '先做一步' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '快捷回应' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '学习帮助' })).not.toBeInTheDocument();
    expect(screen.getByText('题面识别有待核对')).toBeInTheDocument();
    expect(screen.getByText('题解依据仍在核对')).toBeInTheDocument();
    expect(screen.getByText('根号范围待核对')).toBeInTheDocument();
    expect(document.querySelectorAll('.problem-analysis .katex')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '朗读题目分析' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '朗读关键条件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '朗读目标' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '朗读当前问题' })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: '放大查看2024年高考数学试卷（北京）第 1 题',
      }),
    );
    expect(
      screen.getByRole('dialog', {
        name: '题图阅读：2024年高考数学试卷（北京）第 1 题',
      }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
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
    fireEvent.load(await screen.findByRole('img', { name: '第 1 题题目' }));
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

  it('reveals a checked reply atomically after all formula chunks arrive', async () => {
    const encoder = new TextEncoder();
    const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
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
                streamControllers.push(controller);
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
    fireEvent.load(await screen.findByRole('img', { name: '第 1 题题目' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择第 1 题' }));
    await screen.findByRole('heading', { name: '题目分析' });

    expect(screen.getByRole('group', { name: '快捷回应' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我来写' }));
    expect(screen.getByRole('textbox', { name: '输入题目或想法' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '我还不确定' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提示一点' }));

    expect(await screen.findByText('正在核对你的这一步')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止本轮回复' })).toBeEnabled();
    expect(screen.queryByRole('group', { name: '快捷回应' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '学习帮助' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停止本轮回复' }));
    await act(async () => {
      streamControllers[0]?.close();
    });
    expect(await screen.findByText('已停止本轮回复。你的作答已保留，可以重新回答。')).toBeInTheDocument();
    expect(screen.getByLabelText('帮助状态：已请求，尚未发出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新回答' })).toBeEnabled();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入题目或想法' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: '重新回答' }));
    await waitFor(() => expect(streamControllers).toHaveLength(2));
    expect(await screen.findByText('正在核对你的这一步')).toBeInTheDocument();
    const formulaReply = String.raw`有依据：试着把 [ \frac{\sqrt{2}}{\sqrt{3}} ] 的分子分母同时乘以 (\sqrt{3})：[ \frac{\sqrt{2}}{\sqrt{3}}\times\frac{\sqrt{3}}{\sqrt{3}} ]。`;
    await act(async () => {
      streamControllers[1]?.enqueue(
        encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: formulaReply })}\n\n`),
      );
    });
    expect(screen.getByText('正在核对你的这一步')).toBeInTheDocument();
    expect(document.querySelectorAll('.chat-message-guide .katex')).toHaveLength(0);
    expect(screen.queryByText(/试着把/)).not.toBeInTheDocument();
    expect(screen.queryByText('最小提示')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '朗读启思回复' })).not.toBeInTheDocument();

    await act(async () => {
      streamControllers[1]?.enqueue(
        encoder.encode('event: chunk\ndata: {"text":"你先算一下。"}\n\nevent: done\ndata: {}\n\n'),
      );
    });
    expect(await screen.findByText(/你先算一下/)).toBeInTheDocument();
    expect(document.querySelectorAll('.chat-message-guide .katex')).toHaveLength(3);
    expect(screen.getByText('最小提示')).toBeInTheDocument();

    await act(async () => {
      streamControllers[1]?.close();
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入题目或想法' })).toHaveFocus();
    });
    expect(document.querySelectorAll('.chat-message-guide .katex')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '朗读启思回复' })).toBeInTheDocument();
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
