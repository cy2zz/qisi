import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportPage } from './ReportPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReportPage', () => {
  it('shows original work, planning, execution, and remaining verification separately', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      attempts: [{
        assistance_requested: false,
        attempt_id: '81',
        execution: 'incorrect',
        help_exposed: false,
        independent_execution: false,
        independent_planning: true,
        independent_task_pass: false,
        invalidated: false,
        limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
        locked_plan_markdown: '先配方，再利用平方项非负。',
        plan_unanswered: false,
        final_answer_markdown: '$g(x)=(x-3)^2-4$，所以最小值为 $-4$。',
        phase: 'summary',
        planning: 'correct',
        relation: 'near_transfer',
        task_id: '61',
      }],
      delayed_evidence: 'not_evaluated',
      limitations: ['近迁移结果只说明本次任务表现，不等同于长期掌握或提分结论。'],
      observations: ['首次计划明确使用配方法', '最终计算中的常数项有误'],
      original_status: 'unknown',
      session_id: '12',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));

    render(
      <MemoryRouter initialEntries={['/learn/12/report']}>
        <Routes>
          <Route path="/learn/:sessionId/report" element={<ReportPage username="小林" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '这次学习留下了什么证据' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '原题完成与帮助' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本次独立规划' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本次独立执行' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '还需要验证什么' })).toBeInTheDocument();
    expect(screen.getByText('独立证据成立')).toBeInTheDocument();
    expect(screen.getByText('未形成独立通过证据')).toBeInTheDocument();
    const frozenWork = screen.getByRole('region', { name: '本次冻结的独立作答' });
    expect(within(frozenWork).getByRole('heading', { name: '首次计划' })).toBeInTheDocument();
    expect(within(frozenWork).getByText('先配方，再利用平方项非负。')).toBeInTheDocument();
    expect(within(frozenWork).getByRole('heading', { name: '最终答案' })).toBeInTheDocument();
    expect(within(frozenWork).getByText(/所以最小值为/)).toBeInTheDocument();
    expect(frozenWork.querySelectorAll('.katex')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: '方法不用推倒重来，只修执行卡点' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回学习页处理执行卡点' })).toHaveAttribute(
      'href',
      '/study?session=12&remediate=execution',
    );
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });

  it('distinguishes an explicitly skipped plan from an unfinished final answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      attempts: [{
        assistance_requested: false,
        attempt_id: '82',
        execution: 'unanswered',
        final_answer_markdown: null,
        help_exposed: false,
        independent_execution: false,
        independent_planning: false,
        independent_task_pass: false,
        invalidated: false,
        limitations: ['首次计划未作答。', '最终答案未作答。'],
        locked_plan_markdown: '不应展示的旧计划',
        phase: 'check_answer',
        plan_unanswered: true,
        planning: 'unanswered',
        relation: 'near_transfer',
        task_id: '62',
      }],
      delayed_evidence: 'not_evaluated',
      limitations: [],
      observations: ['原题作答有依据。'],
      original_status: 'completed_without_recorded_help',
      session_id: '12',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));

    render(
      <MemoryRouter initialEntries={['/learn/12/report']}>
        <Routes>
          <Route path="/learn/:sessionId/report" element={<ReportPage username="小林" />} />
        </Routes>
      </MemoryRouter>,
    );

    const frozenWork = await screen.findByRole('region', { name: '本次冻结的独立作答' });
    expect(within(frozenWork).getByText('本次明确选择了不写首次计划。')).toBeInTheDocument();
    expect(within(frozenWork).getByText('本次还没有提交最终答案。')).toBeInTheDocument();
    expect(within(frozenWork).queryByText('不应展示的旧计划')).not.toBeInTheDocument();
  });

  it('compares every frozen attempt while keeping the next action based on the latest result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      attempts: [
        {
          assistance_requested: true,
          attempt_id: '80',
          execution: 'incorrect',
          final_answer_markdown: '$m=-3$',
          help_exposed: false,
          independent_execution: false,
          independent_planning: true,
          independent_task_pass: false,
          invalidated: false,
          limitations: ['第一次执行需要修正。'],
          locked_plan_markdown: '先配方判断最小值。',
          phase: 'summary',
          plan_unanswered: false,
          planning: 'correct',
          relation: 'near_transfer',
          task_id: '60',
        },
        {
          assistance_requested: false,
          attempt_id: '81',
          execution: 'correct',
          final_answer_markdown: '$m\\ge -4$',
          help_exposed: false,
          independent_execution: true,
          independent_planning: true,
          independent_task_pass: true,
          invalidated: false,
          limitations: [],
          locked_plan_markdown: '改用判别式核对参数范围。',
          phase: 'summary',
          plan_unanswered: false,
          planning: 'correct',
          relation: 'near_transfer',
          task_id: '61',
        },
      ],
      delayed_evidence: 'not_evaluated',
      limitations: ['长期保持尚未评估。'],
      observations: ['原题作答有依据。'],
      original_status: 'completed_without_recorded_help',
      session_id: '12',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));

    render(
      <MemoryRouter initialEntries={['/learn/12/report']}>
        <Routes>
          <Route path="/learn/:sessionId/report" element={<ReportPage username="小林" />} />
        </Routes>
      </MemoryRouter>,
    );

    const attemptSwitch = await screen.findByRole('group', { name: '切换独立检验记录' });
    const firstAttempt = within(attemptSwitch).getByRole('button', {
      name: /查看第 1 次独立检验：请求过帮助/,
    });
    const latestAttempt = within(attemptSwitch).getByRole('button', { name: /查看第 2 次独立检验/ });
    expect(latestAttempt).toHaveAttribute('aria-pressed', 'true');
    expect(firstAttempt).toHaveAttribute('aria-pressed', 'false');

    const frozenWork = screen.getByRole('region', { name: '本次冻结的独立作答' });
    expect(within(frozenWork).getByText('改用判别式核对参数范围。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本次近迁移成立，下一步看能否稳定保持' })).toBeInTheDocument();

    fireEvent.click(firstAttempt);
    expect(firstAttempt).toHaveAttribute('aria-pressed', 'true');
    expect(within(frozenWork).getByText('先配方判断最小值。')).toBeInTheDocument();
    expect(within(frozenWork).queryByText('改用判别式核对参数范围。')).not.toBeInTheDocument();
    expect(screen.getByText('正在查看第 1 次独立检验')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本次近迁移成立，下一步看能否稳定保持' })).toBeInTheDocument();
    expect(screen.getByText('下一步始终依据最近一次检验，切换记录只用于对照。')).toBeInTheDocument();
  });

  it.each([
    {
      expectedHref: '/study?session=12&remediate=method',
      expectedLabel: '回学习页梳理方法',
      expectedTitle: '先补方法依据，再做下一道题',
      overrides: { execution: 'incorrect', planning: 'incorrect' },
    },
    {
      expectedHref: '/study?session=12&remediate=execution',
      expectedLabel: '回学习页处理执行卡点',
      expectedTitle: '方法不用推倒重来，只修执行卡点',
      overrides: { execution: 'unknown', planning: 'correct' },
    },
    {
      expectedHref: '/study?session=12&remediate=evidence',
      expectedLabel: '查看证据边界',
      expectedTitle: '答案正确不等于这次可以记为独立通过',
      overrides: { assistance_requested: true, execution: 'correct', planning: 'correct' },
    },
    {
      expectedHref: '/learn/12/check?intent=reassess',
      expectedLabel: '再测一道不同新题',
      expectedTitle: '本次近迁移成立，下一步看能否稳定保持',
      overrides: {
        execution: 'correct',
        independent_execution: true,
        independent_planning: true,
        independent_task_pass: true,
        planning: 'correct',
      },
    },
  ])('shows an evidence-driven next action: $expectedLabel', async ({
    expectedHref,
    expectedLabel,
    expectedTitle,
    overrides,
  }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      attempts: [Object.assign({
        assistance_requested: false,
        attempt_id: '81',
        help_exposed: false,
        independent_execution: false,
        independent_planning: false,
        independent_task_pass: false,
        invalidated: false,
        limitations: [],
        phase: 'summary',
        relation: 'near_transfer',
        task_id: '61',
      }, overrides)],
      delayed_evidence: 'not_evaluated',
      limitations: ['长期保持尚未评估。'],
      observations: ['原题作答有依据。'],
      original_status: 'completed_without_recorded_help',
      session_id: '12',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));

    render(
      <MemoryRouter initialEntries={['/learn/12/report']}>
        <Routes>
          <Route path="/learn/:sessionId/report" element={<ReportPage username="小林" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: expectedTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: expectedLabel })).toHaveAttribute('href', expectedHref);
    expect(screen.queryByText(/已经掌握|掌握率|\d+%/)).not.toBeInTheDocument();
  });

  it('recovers from a temporary report failure without trapping the student', async () => {
    let requestCount = 0;
    let resolveRetry: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      requestCount += 1;
      if (requestCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ code: 'TEMPORARY_FAILURE' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503,
        }));
      }
      return new Promise<Response>((resolve) => {
        resolveRetry = resolve;
      });
    });

    render(
      <MemoryRouter initialEntries={['/learn/12/report']}>
        <Routes>
          <Route path="/learn/:sessionId/report" element={<ReportPage username="小林" />} />
        </Routes>
      </MemoryRouter>,
    );

    const retry = await screen.findByRole('button', { name: '重新读取学习报告' });
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法读取学习报告');
    expect(screen.getByRole('link', { name: '回到原题记录' })).toHaveAttribute(
      'href',
      '/study?session=12',
    );
    await waitFor(() => expect(retry).toHaveFocus());

    fireEvent.click(retry);
    expect(screen.getByRole('status')).toHaveTextContent('正在重新读取学习报告');
    expect(screen.getByRole('button', { name: '正在重新读取学习报告' })).toBeDisabled();

    await act(async () => {
      resolveRetry?.(new Response(JSON.stringify({
        attempts: [],
        delayed_evidence: 'not_evaluated',
        limitations: ['近迁移结果只说明本次任务表现。'],
        observations: ['原题仍在进行中。'],
        original_status: 'in_progress',
        session_id: '12',
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));
    });

    const heading = await screen.findByRole('heading', { name: '这次学习留下了什么证据' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(requestCount).toBe(2);
  });

  it('offers safe navigation when the report no longer exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    }));

    render(
      <MemoryRouter initialEntries={['/learn/12/report']}>
        <Routes>
          <Route path="/learn/:sessionId/report" element={<ReportPage username="小林" />} />
        </Routes>
      </MemoryRouter>,
    );

    const heading = await screen.findByRole('heading', { name: '这份学习记录暂时找不到' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole('button', { name: '重新读取学习报告' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到原题记录' })).toHaveAttribute(
      'href',
      '/study?session=12',
    );
    expect(screen.getByRole('link', { name: '查看独立检验' })).toHaveAttribute(
      'href',
      '/learn/12/check',
    );
  });
});
