import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { readCachedLearningDraft } from './pages/bank/learning-draft-cache';

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

// Load the lazy route before asserting UI behavior, not inside the 1s query window.
beforeAll(async () => { await import('./pages/bank/BankFlow'); });

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
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
              metadata: { routeAttribution: 'student' },
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
    expect(screen.getByLabelText('路线归属：沿用你的解法')).toHaveTextContent('沿你的路线');
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

  it('restores legacy learning drafts and keeps further edits local', async () => {
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
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('已恢复草稿，点击发送后提交');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    editor.textContent = '我准备先移项，得到 $a^2-2ab+b^2$。';
    fireEvent.input(editor);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/draft'))).toEqual([]);
    expect(readCachedLearningDraft(window.localStorage, '91')?.markdown)
      .toBe('我准备先移项，得到 $a^2-2ab+b^2$。');
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('草稿已保存在本机，尚未提交');
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

    const classroom = view.getByRole('region', { name: '互动数学课堂' });
    expect(within(classroom).getByRole('img', {
      name: '一对一老师在黑板辅导学生完成二次函数挑战',
    })).toBeInTheDocument();
    expect(within(classroom).getByRole('heading', { name: '一对一数学作战室' }))
      .toBeInTheDocument();

    const needsHelp = within(classroom).getByRole('button', { name: '我卡在这里' });
    fireEvent.click(needsHelp);
    expect(needsHelp).toHaveAttribute('aria-pressed', 'true');
    expect(within(classroom).getByRole('status')).toHaveTextContent('先看为什么要配方');

    fireEvent.click(within(classroom).getByRole('button', { name: '暂停课堂演示' }));
    expect(within(classroom).getByRole('button', { name: '继续课堂演示' }))
      .toBeInTheDocument();
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


describe('learning local drafts', () => {
  const sessionId = '9101';
  const draftUrl = '/api/learning/sessions/' + sessionId + '/draft';

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function completedChat() {
    return Promise.resolve(new Response(
      'event: chunk\ndata: {"text":"已核对本次提交。"}\n\n'
      + 'event: done\ndata: {"version":2}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
  }

  async function mountDraft(expectedText: string) {
    vi.useRealTimers();
    const view = renderApp('/study?session=' + sessionId);
    const editor = await screen.findByRole('textbox', { name: '输入题目或想法' });
    await waitFor(() => {
      expect(editor).toHaveFocus();
      expect(editor.textContent).toBe(expectedText);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    return { ...view, editor };
  }

  async function openDraft(chat = completedChat) {
    window.localStorage.clear();
    const record = {
      content: '化简 $(a-b)^2$。',
      id: sessionId,
      problemMd: '化简 $(a-b)^2$。',
      title: '输入保存测试夹具',
      topic: '多项式',
      version: 1,
    };
    const draftRequests: string[] = [];
    const chatBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/auth/me') return jsonResponse({ user: { id: '7', username: '测试学生' } });
      if (url === '/api/learning/sessions') return jsonResponse({ sessions: [record] });
      if (url === '/api/learning/sessions/' + sessionId) {
        return jsonResponse({
          analysis: { firstQuestion: '你准备从哪里入手？', keyConditions: [], knowledgePoints: [], overview: '化简多项式。', target: '化简' },
          draftMarkdown: '原有草稿',
          messages: [],
          record,
        });
      }
      if (url === draftUrl) {
        draftRequests.push(String(init?.body));
        return jsonResponse({ savedAt: '2026-09-30T00:00:00.000Z' });
      }
      if (url === '/api/problems/chat') {
        chatBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return chat();
      }
      return jsonResponse({});
    });
    return { ...await mountDraft('原有草稿'), draftRequests, chatBodies };
  }

  function edit(editor: HTMLElement, markdown: string) {
    editor.textContent = markdown;
    fireEvent.input(editor);
  }

  async function advance(milliseconds: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
  }

  it('keeps every edit local even after long typing pauses', async () => {
    const { editor, draftRequests, chatBodies } = await openDraft();
    for (const text of ['先', '先展开', '先展开平方']) {
      edit(editor, text);
      expect(editor).toHaveTextContent(text);
      expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe(text);
      await advance(30_000);
      expect(draftRequests).toEqual([]);
      expect(chatBodies).toEqual([]);
    }
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('草稿已保存在本机，尚未提交');
    expect(screen.queryByRole('button', { name: '立即同步' })).not.toBeInTheDocument();
  });

  it('does not upload unchanged input or restored drafts', async () => {
    const { editor, draftRequests } = await openDraft();
    edit(editor, '原有草稿');
    await advance(30_000);
    fireEvent.online(window);
    expect(draftRequests).toEqual([]);
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('已恢复草稿，点击发送后提交');
  });

  it('retains offline edits without uploading on reconnect', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { editor, draftRequests } = await openDraft();
    edit(editor, '离线编辑');
    await advance(30_000);
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('离线编辑');
    online.mockReturnValue(true);
    fireEvent.online(window);
    fireEvent.online(window);
    await advance(30_000);
    expect(draftRequests).toEqual([]);
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('离线编辑');
    expect(screen.getByRole('status', { name: '草稿保存状态' })).not.toHaveTextContent(/等待网络|同步/);
  });

  it.each(['本机修改后的草稿', '', '原有草稿'])('restores local text %j over the legacy server draft without deleting the local copy', async (markdown) => {
    const { editor: originalEditor, unmount, draftRequests } = await openDraft();
    edit(originalEditor, markdown);
    unmount();
    const { editor } = await mountDraft(markdown);
    await advance(30_000);
    expect(editor.textContent).toBe(markdown);
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe(markdown);
    expect(draftRequests).toEqual([]);
  });

  it('keeps text editable when local storage fails without falling back to network saves', async () => {
    const { editor, draftRequests } = await openDraft();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable fixture'); });
    edit(editor, '只在本页的输入');
    await advance(30_000);
    fireEvent.online(window);
    expect(draftRequests).toEqual([]);
    expect(editor).toHaveTextContent('只在本页的输入');
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('无法保存到本机，内容仅保留在本页');
  });

  it('sends the latest text only on explicit submit and suppresses stale legacy drafts after success', async () => {
    const { editor, unmount, draftRequests, chatBodies } = await openDraft();
    edit(editor, '第一版');
    edit(editor, '最终作答');
    expect(chatBodies).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await advance(0);
    expect(chatBodies).toEqual([expect.objectContaining({ message: '最终作答', sessionId, expectedVersion: 1 })]);
    expect(draftRequests).toEqual([]);
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('');
    unmount();
    const restored = await mountDraft('');
    expect(restored.editor.textContent).toBe('');
  });

  it('preserves a failed submission locally for refresh and retry', async () => {
    const { editor, unmount, draftRequests, chatBodies } = await openDraft(() => Promise.reject(new TypeError('offline fixture')));
    edit(editor, '提交失败不能丢失');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await advance(0);
    expect(chatBodies).toHaveLength(1);
    expect(screen.getByText('暂时无法回应这一步。你的内容已经保留，可以重试。')).toBeInTheDocument();
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('提交失败不能丢失');
    expect(draftRequests).toEqual([]);
    unmount();
    await mountDraft('提交失败不能丢失');
  });

  it('does not clear edits made while a submission is still pending', async () => {
    let finishChat!: (response: Response) => void;
    const { editor, draftRequests } = await openDraft(() => new Promise<Response>((resolve) => { finishChat = resolve; }));
    edit(editor, '本次提交');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('本次提交');
    edit(editor, '下一条草稿');
    await act(async () => { finishChat(await completedChat()); });
    await advance(30_000);
    expect(editor).toHaveTextContent('下一条草稿');
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('下一条草稿');
    expect(draftRequests).toEqual([]);
  });

  it('does not discard a newly composed identical draft when retrying an older submission', async () => {
    let attempts = 0;
    const { editor, draftRequests } = await openDraft(() => ++attempts === 1
      ? Promise.reject(new TypeError('offline fixture'))
      : completedChat());
    edit(editor, '相同内容');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await advance(0);
    edit(editor, '相同内容');
    fireEvent.click(screen.getByRole('button', { name: '重新回答' }));
    await advance(0);
    expect(editor).toHaveTextContent('相同内容');
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('相同内容');
    expect(draftRequests).toEqual([]);
  });

  it('does not upload on unmount and retains the last local edit', async () => {
    const { editor, unmount, draftRequests } = await openDraft();
    edit(editor, '离开前最后输入');
    unmount();
    await advance(30_000);
    expect(draftRequests).toEqual([]);
    expect(readCachedLearningDraft(window.localStorage, sessionId)?.markdown).toBe('离开前最后输入');
  });
});
