import { cleanup, render, screen } from '@testing-library/react';
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
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });
});
