import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RealtimeSpeechCallbacks } from '../../../features/input/speech-client';
import { AssessmentCheckPage } from './AssessmentCheckPage';
import {
  assessmentDraftCacheKey,
  writeCachedAssessmentDraft,
} from './assessment-draft-cache';

const voiceMocks = vi.hoisted(() => ({
  callbacks: undefined as RealtimeSpeechCallbacks | undefined,
  captureStop: vi.fn(),
  sessionClose: vi.fn(),
  sessionFinish: vi.fn(),
}));

vi.mock('../../../features/input/audio-capture', () => ({
  createWavHeader: vi.fn(() => new ArrayBuffer(44)),
  pcmToArrayBuffer: vi.fn(() => new ArrayBuffer(8)),
  startAudioCapture: vi.fn().mockImplementation(async () => ({ stop: voiceMocks.captureStop })),
}));

vi.mock('../../../features/input/speech-client', () => ({
  createRealtimeSpeechSession: vi.fn().mockImplementation((callbacks: RealtimeSpeechCallbacks) => {
    voiceMocks.callbacks = callbacks;
    return {
      close: voiceMocks.sessionClose,
      finish: voiceMocks.sessionFinish,
      sendAudio: vi.fn(),
    };
  }),
  transcribeShortSpeech: vi.fn(),
}));

const baseAttempt = {
  answerDraftMarkdown: '',
  assistanceRequested: false,
  finalAnswerMarkdown: null,
  firstSeenEligible: true,
  helpExposed: false,
  helpSessionId: null,
  id: '81',
  lockedPlanMarkdown: null,
  phase: 'check_plan' as const,
  planDraftMarkdown: '',
  planUnanswered: false,
  promptMarkdown: '求函数 $g(x)=x^2-6x+5$ 的最小值。',
  relation: 'near_transfer' as const,
  result: null,
  sessionId: '12',
  taskId: '61',
  version: 1,
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      status,
    }),
  );
}

function renderPage(initialEntry = '/learn/12/check') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/learn/:sessionId/check"
          element={<AssessmentCheckPage username="小林" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssessmentCheckPage', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    voiceMocks.callbacks = undefined;
  });

  it('restores an unsynced local plan after refresh and syncs it when the network returns', async () => {
    let allowDraftSync = false;
    let storedAttempt = {
      ...baseAttempt,
      planDraftMarkdown: '云端旧计划：先配方。',
    };
    const requestKinds: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: storedAttempt });
      }
      if (url.endsWith('/draft') && init?.method === 'PATCH') {
        requestKinds.push('draft');
        if (!allowDraftSync) return jsonResponse({ message: 'offline' }, 503);
        const body = JSON.parse(String(init.body)) as {
          markdown: string;
        };
        storedAttempt = {
          ...storedAttempt,
          planDraftMarkdown: body.markdown,
          version: storedAttempt.version + 1,
        };
        return jsonResponse({ attempt: storedAttempt });
      }
      if (url.endsWith('/plan')) requestKinds.push('plan');
      if (url.endsWith('/finish')) requestKinds.push('finish');
      if (url.endsWith('/help')) requestKinds.push('help');
      return jsonResponse({});
    });

    renderPage();
    const editor = await screen.findByRole('textbox', { name: '独立检验作答' });
    expect(editor).toHaveValue('云端旧计划：先配方。');
    const localPlan = '先配方得到 $g(x)=(x-3)^2-4$，再判断平方项非负。';
    fireEvent.change(editor, { target: { value: localPlan } });

    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('尚未保存');
    expect(await screen.findByText('已保存在本机，等待网络恢复', {}, { timeout: 2_500 }))
      .toBeInTheDocument();
    expect(Object.keys(localStorage).some((key) => key.includes('assessment'))).toBe(true);
    expect(requestKinds).toEqual(['draft']);

    cleanup();
    renderPage();
    expect(await screen.findByRole('textbox', { name: '独立检验作答' })).toHaveValue(localPlan);
    expect(screen.getByRole('status', { name: '草稿保存状态' }))
      .toHaveTextContent('已恢复本机草稿，尚未同步');
    expect(requestKinds).toEqual(['draft']);

    allowDraftSync = true;
    fireEvent(window, new Event('online'));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('已自动保存');
    });
    expect(storedAttempt.planDraftMarkdown).toBe(localPlan);
    expect(Object.keys(localStorage).some((key) => key.includes('assessment'))).toBe(false);
    expect(requestKinds).toEqual(['draft', 'draft']);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/plan'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/finish'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/help'))).toBe(false);
  });

  it('restores only the answer draft after the first plan has been locked', async () => {
    const answerAttempt = {
      ...baseAttempt,
      answerDraftMarkdown: '云端旧答案',
      lockedPlanMarkdown: '先配方。',
      phase: 'check_answer' as const,
      planDraftMarkdown: '先配方。',
      version: 2,
    };
    writeCachedAssessmentDraft(localStorage, '81', 'check_plan', '未锁定的本机计划');
    writeCachedAssessmentDraft(
      localStorage,
      '81',
      'check_answer',
      '本机答案：$g(x)=(x-3)^2-4$。',
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: answerAttempt });
      }
      return jsonResponse({});
    });

    renderPage();
    expect(await screen.findByRole('textbox', { name: '独立检验作答' })).toHaveValue(
      '本机答案：$g(x)=(x-3)^2-4$。',
    );
    expect(screen.getByRole('note', { name: '已锁定的首次计划' })).toHaveTextContent('先配方');
    expect(screen.getByRole('status', { name: '草稿保存状态' }))
      .toHaveTextContent('已恢复本机草稿，尚未同步');
    expect(localStorage.getItem(assessmentDraftCacheKey('81', 'check_plan'))).toBeNull();
    expect(localStorage.getItem(assessmentDraftCacheKey('81', 'check_answer'))).not.toBeNull();
  });

  it('requires an explicit confirmation before freezing an empty final answer', async () => {
    const answerAttempt = {
      ...baseAttempt,
      lockedPlanMarkdown: '先配方。',
      phase: 'check_answer' as const,
      planDraftMarkdown: '先配方。',
      version: 2,
    };
    const finishBodies: Array<{ answerMarkdown: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: answerAttempt });
      }
      if (url.endsWith('/finish')) {
        finishBodies.push(JSON.parse(String(init?.body)) as { answerMarkdown: string });
        return jsonResponse({
          attempt: {
            ...answerAttempt,
            finalAnswerMarkdown: '',
            phase: 'summary',
            result: {
              evidence: ['首次计划已锁定，最终答案为空白。'],
              execution: 'unanswered',
              independentExecution: false,
              independentPlanning: true,
              independentTaskPass: false,
              limitations: ['没有最终答案，无法核对执行。'],
              planning: 'correct',
              summary: '计划有依据，但没有留下最终答案。',
            },
            version: 4,
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();
    await screen.findByRole('heading', { name: '现在独立完成答案' });
    expect(screen.getByRole('button', { name: '提交最终答案' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '暂时不作答' }));
    const confirmation = screen.getByRole('alertdialog', {
      name: '以空白答案结束本次检验？',
    });
    expect(confirmation).toHaveTextContent('提交后答案会冻结');
    expect(screen.getByRole('button', { name: '继续作答' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '继续作答' }));
    expect(confirmation).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '独立检验作答' })).toHaveFocus();
    });
    expect(finishBodies).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '暂时不作答' }));
    fireEvent.click(screen.getByRole('button', { name: '确认未作答并结束' }));
    expect(await screen.findByRole('heading', { name: '这次还没有留下执行证据' }))
      .toBeInTheDocument();
    expect(finishBodies).toEqual([expect.objectContaining({ answerMarkdown: '' })]);
  });

  it('autosaves an unfinished plan and restores it after refresh without grading', async () => {
    let storedAttempt = baseAttempt;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: storedAttempt });
      }
      if (url.endsWith('/draft') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as {
          expectedVersion: number;
          kind: 'answer' | 'plan';
          markdown: string;
        };
        storedAttempt = {
          ...storedAttempt,
          planDraftMarkdown: body.markdown,
          version: storedAttempt.version + 1,
        };
        return jsonResponse({ attempt: storedAttempt });
      }
      return jsonResponse({});
    });

    renderPage();
    const editor = await screen.findByRole('textbox', { name: '独立检验作答' });
    fireEvent.change(editor, { target: { value: '先配方，再利用平方项非负。' } });

    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('尚未保存');
    await waitFor(
      () => expect(fetchMock).toHaveBeenCalledWith(
        '/api/assessment/attempts/81/draft',
        expect.objectContaining({ method: 'PATCH' }),
      ),
      { timeout: 2_500 },
    );
    expect(await screen.findByText('已自动保存')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/finish'))).toBe(false);

    cleanup();
    renderPage();
    expect(await screen.findByRole('textbox', { name: '独立检验作答' })).toHaveValue(
      '先配方，再利用平方项非负。',
    );
  });

  it('does not replace newer typing when an older autosave response arrives', async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: baseAttempt });
      }
      if (url.endsWith('/draft')) {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve;
        });
      }
      return jsonResponse({});
    });

    renderPage();
    const editor = await screen.findByRole('textbox', { name: '独立检验作答' });
    fireEvent.change(editor, { target: { value: '先配方。' } });
    await waitFor(() => expect(resolveSave).toBeTypeOf('function'), { timeout: 2_500 });

    fireEvent.change(editor, { target: { value: '先配方，再看平方项非负。' } });
    await act(async () => {
      resolveSave?.(new Response(JSON.stringify({
        attempt: { ...baseAttempt, planDraftMarkdown: '先配方。', version: 2 },
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));
    });

    expect(editor).toHaveValue('先配方，再看平方项非负。');
    expect(screen.getByRole('status', { name: '草稿保存状态' })).toHaveTextContent('尚未保存');
  });

  it('puts the caret inside formula slots and advances without making students hunt for braces', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: baseAttempt });
      }
      return jsonResponse({});
    });

    renderPage();
    const editor = await screen.findByRole('textbox', { name: '独立检验作答' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: '插入分式' }));

    expect(editor).toHaveValue('$\\frac{}{}$');
    await waitFor(() => expect(editor.selectionStart).toBe(editor.value.indexOf('{}') + 1));

    fireEvent.change(editor, { target: { value: '$\\frac{2}{}$' } });
    const firstSlotEnd = editor.value.indexOf('2') + 1;
    editor.setSelectionRange(firstSlotEnd, firstSlotEnd);
    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(editor.selectionStart).toBe(editor.value.indexOf('{}') + 1);

    expect(screen.getByRole('button', { name: '移动到下一个公式输入格' })).toBeInTheDocument();
  });

  it('returns focus to the answer after formatting a spoken-style formula', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: baseAttempt });
      }
      if (url === '/api/speech/format-math' && init?.method === 'POST') {
        return jsonResponse({
          formatted: true,
          markdown: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
        });
      }
      return jsonResponse({ attempt: baseAttempt });
    });

    renderPage();
    const editor = await screen.findByRole('textbox', {
      name: '独立检验作答',
    }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '根号2除以根号3等于多少？' } });
    editor.focus();

    fireEvent.click(screen.getByRole('button', { name: '公式转换' }));

    await waitFor(() => {
      expect(editor).toHaveValue('$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？');
    });
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(editor.value.length);
    expect(editor.selectionEnd).toBe(editor.value.length);
  });

  it('replaces realtime voice draft with formatted mathematics inside the independent plan', async () => {
    voiceMocks.captureStop.mockResolvedValue(new Blob([], { type: 'audio/wav' }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({
          attempt: { ...baseAttempt, planDraftMarkdown: '先看定义域。' },
        });
      }
      return jsonResponse({});
    });

    renderPage();
    const editor = await screen.findByRole('textbox', {
      name: '独立检验作答',
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length);

    fireEvent.click(screen.getByRole('button', { name: '实时语音' }));
    await act(async () => Promise.resolve());
    act(() => voiceMocks.callbacks?.onReady());
    act(() => voiceMocks.callbacks?.onTranscript('根号2除以根号3', false));
    expect(editor).toHaveValue('先看定义域。 根号2除以根号3');

    act(() => voiceMocks.callbacks?.onDone('$\\frac{\\sqrt{2}}{\\sqrt{3}}$', true));
    expect(editor).toHaveValue('先看定义域。 $\\frac{\\sqrt{2}}{\\sqrt{3}}$');
    expect(screen.getByText('公式已整理，请检查后发送。')).toBeInTheDocument();
  });

  it('binds a confirmed handwriting revision to the locked assessment plan', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:assessment-handwriting');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const requestBodies: Array<Record<string, unknown>> = [];
    let currentPhase: 'check_answer' | 'check_plan' = 'check_plan';
    let currentVersion = 1;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({
          attempt: { ...baseAttempt, phase: currentPhase, version: currentVersion },
        });
      }
      if (url === '/api/media/handwriting?sessionId=12') {
        return jsonResponse({
          image: { height: 600, mediaId: '31', url: '/api/media/31', width: 900 },
          transcript: {
            confirmed: false,
            id: '41',
            lines: [
              { explicitly_confirmed: false, index: 1, text: '先配方', uncertain: false },
              { explicitly_confirmed: false, index: 2, text: '再利用平方项非负', uncertain: true },
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
            { explicitly_confirmed: false, index: 1, text: '先配方', uncertain: false },
            { explicitly_confirmed: true, index: 2, text: '再利用平方项非负', uncertain: true },
          ],
          media_id: '31',
          revision: 2,
        });
      }
      if (url.endsWith('/plan')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
          expectedVersion: number;
        };
        requestBodies.push(body);
        currentPhase = 'check_answer';
        currentVersion = body.expectedVersion + 1;
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            lockedPlanMarkdown: '先配方\n\n再利用平方项非负',
            phase: currentPhase,
            planDraftMarkdown: '先配方\n\n再利用平方项非负',
            version: currentVersion,
          },
        });
      }
      if (url.endsWith('/finish')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
          expectedVersion: number;
        };
        requestBodies.push(body);
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            finalAnswerMarkdown: '先配方\n\n再利用平方项非负',
            lockedPlanMarkdown: '先配方\n\n再利用平方项非负',
            phase: 'summary',
            result: {
              evidence: [],
              execution: 'unknown',
              independentExecution: false,
              independentPlanning: false,
              independentTaskPass: false,
              limitations: ['fixture'],
              planning: 'unknown',
              summary: '本测试只核对手写来源绑定。',
            },
            version: body.expectedVersion + 2,
          },
        });
      }
      if (url.endsWith('/draft')) {
        const body = JSON.parse(String(init?.body)) as {
          expectedVersion: number;
          kind: 'answer' | 'plan';
          markdown: string;
        };
        currentVersion = body.expectedVersion + 1;
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            answerDraftMarkdown: body.kind === 'answer' ? body.markdown : '',
            lockedPlanMarkdown: currentPhase === 'check_answer'
              ? '先配方\n\n再利用平方项非负'
              : null,
            phase: currentPhase,
            planDraftMarkdown: body.kind === 'plan' ? body.markdown : '先配方\n\n再利用平方项非负',
            version: currentVersion,
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();
    await screen.findByRole('textbox', { name: '独立检验作答' });
    fireEvent.click(screen.getByRole('button', { name: '添加手写作答' }));
    const image = new File([new Uint8Array([1, 2, 3])], 'plan.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('选择手写作答图片'), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByRole('button', { name: '识别手写作答' }));

    const confirmTranscript = await screen.findByRole('button', {
      name: '确认转写并放入输入框',
    });
    expect(confirmTranscript).toBeDisabled();
    expect(screen.getByRole('button', { name: '锁定计划，开始作答' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '确认第 2 行' }));
    fireEvent.click(confirmTranscript);

    const editor = await screen.findByRole('textbox', { name: '独立检验作答' });
    expect(editor).toHaveValue('先配方\n\n再利用平方项非负');
    expect(screen.getByText('手写转写已确认；继续编辑后将按普通文字提交。')).toBeInTheDocument();
    const lockPlan = screen.getByRole('button', { name: '锁定计划，开始作答' });
    await waitFor(() => expect(lockPlan).toBeEnabled());
    fireEvent.click(lockPlan);

    await screen.findByRole('heading', { name: '现在独立完成答案' });
    expect(requestBodies[0]).toMatchObject({
      noPlan: false,
      planMarkdown: '先配方\n\n再利用平方项非负',
      transcriptId: '41',
      transcriptRevision: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/media/handwriting?sessionId=12',
      expect.objectContaining({ body: image, method: 'POST' }),
    );

    fireEvent.click(screen.getByRole('button', { name: '添加手写作答' }));
    fireEvent.change(screen.getByLabelText('选择手写作答图片'), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByRole('button', { name: '识别手写作答' }));
    const confirmAnswer = await screen.findByRole('button', {
      name: '确认转写并放入输入框',
    });
    fireEvent.click(screen.getByRole('button', { name: '确认第 2 行' }));
    fireEvent.click(confirmAnswer);
    const answerEditor = await screen.findByRole('textbox', { name: '独立检验作答' });
    fireEvent.change(answerEditor, {
      target: { value: '先配方\n\n再利用平方项非负\n\n我补充说明这是配方法。' },
    });
    expect(screen.queryByText('手写转写已确认；继续编辑后将按普通文字提交。')).not.toBeInTheDocument();
    const submitAnswer = screen.getByRole('button', { name: '提交最终答案' });
    await waitFor(() => expect(submitAnswer).toBeEnabled());
    fireEvent.click(submitAnswer);

    await screen.findByRole('heading', { name: '计划证据还不足' });
    expect(requestBodies[1]).toMatchObject({
      answerMarkdown: '先配方\n\n再利用平方项非负\n\n我补充说明这是配方法。',
    });
    expect(requestBodies[1]).not.toHaveProperty('transcriptId');
    expect(requestBodies[1]).not.toHaveProperty('transcriptRevision');
  });

  it('locks the first plan, withholds correctness during work, and grades only after finish', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) return jsonResponse({}, 404);
      if (url.endsWith('/start')) return jsonResponse({ attempt: baseAttempt });
      if (url.endsWith('/plan')) {
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            lockedPlanMarkdown: '先配方，再利用平方项非负。',
            phase: 'check_answer',
            planDraftMarkdown: '先配方，再利用平方项非负。',
            version: 2,
          },
        });
      }
      if (url.endsWith('/finish')) {
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            finalAnswerMarkdown: '$g(x)=(x-3)^2-4$，最小值为 $-4$。',
            lockedPlanMarkdown: '先配方，再利用平方项非负。',
            phase: 'summary',
            result: {
              evidence: ['首次计划明确使用配方法', '最终答案给出顶点式与最小值'],
              execution: 'correct',
              independentExecution: true,
              independentPlanning: true,
              independentTaskPass: true,
              limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
              planning: 'correct',
              summary: '首次计划与最终执行均有依据。',
            },
            version: 4,
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '开始独立检验' }));
    expect(await screen.findByRole('heading', { name: '先写你准备怎么做' })).toBeInTheDocument();
    expect(screen.queryByText('有依据')).not.toBeInTheDocument();

    const editor = screen.getByRole('textbox', { name: '独立检验作答' });
    expect(editor).toHaveFocus();
    fireEvent.change(editor, { target: { value: '先配方，再利用平方项非负。' } });
    fireEvent.click(screen.getByRole('button', { name: '锁定计划，开始作答' }));

    expect(await screen.findByRole('note', { name: '已锁定的首次计划' })).toHaveTextContent(
      '先配方，再利用平方项非负。',
    );
    expect(screen.getByRole('heading', { name: '现在独立完成答案' })).toBeInTheDocument();
    expect(screen.queryByText('有依据')).not.toBeInTheDocument();

    const answerEditor = screen.getByRole('textbox', { name: '独立检验作答' });
    expect(answerEditor).toHaveFocus();
    fireEvent.change(answerEditor, {
      target: { value: '$g(x)=(x-3)^2-4$，最小值为 $-4$。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交最终答案' }));

    expect(await screen.findByRole('heading', { name: '这次新题独立完成' })).toBeInTheDocument();
    expect(screen.getAllByText('有依据')).toHaveLength(2);
    const submittedEvidence = screen.getByRole('region', { name: '你的独立作答证据' });
    expect(submittedEvidence).toHaveTextContent('先配方，再利用平方项非负。');
    expect(submittedEvidence).toHaveTextContent('最小值为');
    expect(submittedEvidence.querySelectorAll('.katex')).not.toHaveLength(0);
    expect(screen.getByRole('region', { name: '本次核对依据' })).toHaveTextContent(
      '最终答案给出顶点式与最小值',
    );
    const planBody = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/plan'))?.[1]?.body),
    ) as { noPlan: boolean; planMarkdown: string };
    expect(planBody).toEqual({
      expectedVersion: 1,
      noPlan: false,
      planMarkdown: '先配方，再利用平方项非负。',
    });
  });

  it('returns a direct-url visitor to an original answer that still needs correction', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) return jsonResponse({}, 404);
      if (url.endsWith('/start')) {
        return jsonResponse({ code: 'ORIGINAL_ANSWER_NOT_READY' }, 409);
      }
      return jsonResponse({});
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '开始独立检验' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('先回到原题完成核对');
    expect(screen.getByRole('link', { name: '返回原题完成核对' })).toHaveAttribute(
      'href',
      '/study?session=12',
    );
  });

  it('shows the irreversible help boundary and saves the current draft first', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12') return jsonResponse({ attempt: baseAttempt });
      if (url.endsWith('/help')) {
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            assistanceRequested: true,
            helpSessionId: '91',
            phase: 'help_requested',
            planDraftMarkdown: '我准备先配方。',
            version: 2,
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();
    const editor = await screen.findByRole('textbox', { name: '独立检验作答' });
    fireEvent.change(editor, { target: { value: '我准备先配方。' } });
    fireEvent.click(screen.getByRole('button', { name: '我需要帮助' }));

    const confirmation = screen
      .getByText('结束本次独立检验并求助？')
      .closest('[role="alertdialog"]') as HTMLElement;
    expect(confirmation).not.toBeNull();
    expect(confirmation).toHaveAttribute('aria-modal', 'true');
    expect(confirmation).toHaveTextContent('只记为“带帮助完成”');
    const continueWorking = screen.getByRole('button', { name: '继续独立完成' });
    const confirmHelp = screen.getByRole('button', { name: '确认求助' });
    expect(continueWorking).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirmHelp).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(continueWorking).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('结束本次独立检验并求助？')).not.toBeInTheDocument();
    await waitFor(() => expect(editor).toHaveFocus());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/help'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '我需要帮助' }));
    fireEvent.click(screen.getByRole('button', { name: '确认求助' }));

    expect(await screen.findByText('当前草稿已保留')).toBeInTheDocument();
    expect(screen.getByText(/实际帮助尚未发出/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入同题教学' })).toHaveAttribute(
      'href',
      '/study?session=91',
    );
    const helpBody = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/help'))?.[1]?.body),
    ) as { currentMarkdown: string };
    expect(helpBody.currentMarkdown).toBe('我准备先配方。');
  });

  it('starts a genuinely different reassessment from the completed summary', async () => {
    const completedAttempt = {
      ...baseAttempt,
      finalAnswerMarkdown: '$g(x)=(x-3)^2-4$。',
      lockedPlanMarkdown: '先配方。',
      phase: 'summary' as const,
      result: {
        evidence: ['计划与执行均有依据'],
        execution: 'correct' as const,
        independentExecution: true,
        independentPlanning: true,
        independentTaskPass: true,
        limitations: ['任务尚未经过人工审题。'],
        planning: 'correct' as const,
        summary: '首次计划与最终执行均有依据。',
      },
      version: 4,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: completedAttempt });
      }
      if (url === '/api/assessment/sessions/12/reassess') {
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            id: '82',
            promptMarkdown: '抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？',
            sessionId: '13',
            taskId: '62',
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '再测一道不同的新题' }));

    expect(await screen.findByRole('heading', { name: '先写你准备怎么做' })).toBeInTheDocument();
    expect(screen.getByText(/顶点纵坐标/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assessment/sessions/12/reassess',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('enters a different new task directly when correction hands off with reassessment intent', async () => {
    const completedAttempt = {
      ...baseAttempt,
      finalAnswerMarkdown: '$g(x)=(x-3)^2+4$。',
      lockedPlanMarkdown: '先配方，再修正常数项。',
      phase: 'summary' as const,
      result: {
        evidence: ['修正前的独立检验执行有误'],
        execution: 'incorrect' as const,
        independentExecution: false,
        independentPlanning: true,
        independentTaskPass: false,
        limitations: ['这份结果只用于保留修正前证据。'],
        planning: 'correct' as const,
        summary: '计划有依据，执行需要修正。',
      },
      version: 4,
    };
    const reassessment = {
      ...baseAttempt,
      id: '82',
      promptMarkdown: '抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？',
      sessionId: '13',
      taskId: '62',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: completedAttempt });
      }
      if (url === '/api/assessment/sessions/12/reassess') {
        return jsonResponse({ attempt: reassessment });
      }
      return jsonResponse({});
    });

    renderPage('/learn/12/check?intent=reassess');

    expect(await screen.findByRole('heading', { name: '先写你准备怎么做' })).toBeInTheDocument();
    expect(screen.getByText(/顶点纵坐标/)).toBeInTheDocument();
    expect(screen.queryByText('计划有依据，执行需要修正。')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assessment/sessions/12/reassess',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('starts the first independent task directly when reassessment intent has no earlier attempt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({}, 404);
      }
      if (url === '/api/assessment/sessions/12/start') {
        return jsonResponse({ attempt: baseAttempt });
      }
      return jsonResponse({});
    });

    renderPage('/learn/12/check?intent=reassess');

    expect(await screen.findByRole('heading', { name: '先写你准备怎么做' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assessment/sessions/12/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('restores an unfinished reassessment without creating another task', async () => {
    const activeReassessment = {
      ...baseAttempt,
      id: '82',
      planDraftMarkdown: '先求对称轴。',
      promptMarkdown: '抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？',
      sessionId: '13',
      taskId: '62',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: activeReassessment });
      }
      return jsonResponse({});
    });

    renderPage('/learn/12/check?intent=reassess');

    expect(await screen.findByRole('textbox', { name: '独立检验作答' })).toHaveValue('先求对称轴。');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/reassess'))).toBe(false);
  });

  it('keeps the earlier summary visible when automatic reassessment is not ready', async () => {
    const completedAttempt = {
      ...baseAttempt,
      finalAnswerMarkdown: '$g(x)=(x-3)^2+4$。',
      lockedPlanMarkdown: '先配方。',
      phase: 'summary' as const,
      result: {
        evidence: ['最终常数项计算有误'],
        execution: 'incorrect' as const,
        independentExecution: false,
        independentPlanning: true,
        independentTaskPass: false,
        limitations: ['任务尚未经过人工审题。'],
        planning: 'correct' as const,
        summary: '计划有依据，执行需要修正。',
      },
      version: 4,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: completedAttempt });
      }
      if (url === '/api/assessment/sessions/12/reassess') return jsonResponse({}, 422);
      return jsonResponse({});
    });

    renderPage('/learn/12/check?intent=reassess');

    expect(await screen.findByRole('heading', { name: '方法有依据，执行还需要修正' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('暂时没有可可靠检验的不同新题');
    expect(screen.getByText('计划有依据，执行需要修正。')).toBeInTheDocument();
  });

  it('routes an execution failure back to remediation before offering another test', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            finalAnswerMarkdown: '$g(x)=(x-3)^2+4$。',
            lockedPlanMarkdown: '先配方，再利用平方项非负。',
            phase: 'summary',
            result: {
              evidence: ['首次计划明确使用配方法', '最终常数项计算有误'],
              execution: 'incorrect',
              independentExecution: false,
              independentPlanning: true,
              independentTaskPass: false,
              limitations: ['任务尚未经过人工审题。'],
              planning: 'correct',
              summary: '计划有依据，执行需要修正。',
            },
            version: 4,
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: '方法有依据，执行还需要修正' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '回学习页处理执行卡点' })).toHaveAttribute(
      'href',
      '/study?session=12&remediate=execution',
    );
    expect(screen.getByText('先修正执行，再决定是否换题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '换题再测' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再测一道不同的新题' })).not.toBeInTheDocument();
  });

  it('routes a planning failure back to method work first', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            finalAnswerMarkdown: '$g(x)=4$。',
            lockedPlanMarkdown: '先代入几个数试试。',
            phase: 'summary',
            result: {
              evidence: ['首次计划没有说明如何覆盖定义域'],
              execution: 'unknown',
              independentExecution: false,
              independentPlanning: false,
              independentTaskPass: false,
              limitations: ['现有证据不足。'],
              planning: 'incorrect',
              summary: '计划需要先修正。',
            },
            version: 4,
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: '方法还需要修正' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '回学习页梳理方法' })).toHaveAttribute(
      'href',
      '/study?session=12&remediate=method',
    );
    expect(screen.getByText('先把方法想清楚，再决定是否换题')).toBeInTheDocument();
  });

  it('explains the evidence boundary when both verdicts are correct but the task is not independently passed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({
          attempt: {
            ...baseAttempt,
            finalAnswerMarkdown: '$g(x)=(x-3)^2-4$。',
            lockedPlanMarkdown: '先配方。',
            phase: 'summary',
            result: {
              evidence: ['计划与执行均有依据', '本次发生过帮助请求'],
              execution: 'correct',
              independentExecution: false,
              independentPlanning: false,
              independentTaskPass: false,
              limitations: ['本次不满足独立检验资格。'],
              planning: 'correct',
              summary: '答案有依据，但不能记为独立通过。',
            },
            version: 4,
          },
        });
      }
      return jsonResponse({});
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: '答案有依据，但这次不能记为独立通过' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '回学习页查看证据边界' })).toHaveAttribute(
      'href',
      '/study?session=12&remediate=evidence',
    );
    expect(screen.getByText('先看清为什么这次还不能记为独立通过')).toBeInTheDocument();
  });

  it('keeps the completed summary when no distinct reassessment is ready', async () => {
    const completedAttempt = {
      ...baseAttempt,
      finalAnswerMarkdown: '$g(x)=(x-3)^2-4$。',
      lockedPlanMarkdown: '先配方。',
      phase: 'summary' as const,
      result: {
        evidence: ['计划与执行均有依据'],
        execution: 'correct' as const,
        independentExecution: true,
        independentPlanning: true,
        independentTaskPass: true,
        limitations: ['任务尚未经过人工审题。'],
        planning: 'correct' as const,
        summary: '首次计划与最终执行均有依据。',
      },
      version: 4,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/assessment/sessions/12' && !init?.method) {
        return jsonResponse({ attempt: completedAttempt });
      }
      if (url === '/api/assessment/sessions/12/reassess') return jsonResponse({}, 422);
      return jsonResponse({});
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '再测一道不同的新题' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时没有可可靠检验的不同新题');
    expect(screen.getByRole('heading', { name: '这次新题独立完成' })).toBeInTheDocument();
  });
});
