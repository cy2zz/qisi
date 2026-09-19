import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AssessmentCheckPage } from './AssessmentCheckPage';

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

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/learn/12/check']}>
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
    vi.restoreAllMocks();
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
    fireEvent.change(editor, { target: { value: '先配方，再利用平方项非负。' } });
    fireEvent.click(screen.getByRole('button', { name: '锁定计划，开始作答' }));

    expect(await screen.findByRole('note', { name: '已锁定的首次计划' })).toHaveTextContent(
      '先配方，再利用平方项非负。',
    );
    expect(screen.getByRole('heading', { name: '现在独立完成答案' })).toBeInTheDocument();
    expect(screen.queryByText('有依据')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '独立检验作答' }), {
      target: { value: '$g(x)=(x-3)^2-4$，最小值为 $-4$。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交最终答案' }));

    expect(await screen.findByRole('heading', { name: '这次新题独立完成' })).toBeInTheDocument();
    expect(screen.getAllByText('有依据')).toHaveLength(2);
    const planBody = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/plan'))?.[1]?.body),
    ) as { noPlan: boolean; planMarkdown: string };
    expect(planBody).toEqual({
      expectedVersion: 1,
      noPlan: false,
      planMarkdown: '先配方，再利用平方项非负。',
    });
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
      .closest('[role="alertdialog"]');
    expect(confirmation).not.toBeNull();
    expect(confirmation).toHaveTextContent('只记为“带帮助完成”');
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
