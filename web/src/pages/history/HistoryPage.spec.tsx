import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPage } from './HistoryPage';

const response = {
  entries: [
    {
      assessment: {
        assistance_requested: false,
        execution: 'incorrect',
        help_exposed: false,
        independent_task_pass: false,
        limitations: ['最终执行仍需要修正。'],
        phase: 'summary',
        planning: 'correct',
        relation: 'near_transfer',
      },
      help: { exposed: true, modes: ['hint'], requested: true },
      latest_student_work_markdown: String.raw`我先把 $x^2-4x$ 配成完全平方。`,
      original_status: 'completed_with_help',
      session_id: '12',
      title: '二次函数最值',
      topic: '二次函数',
      updated_at: '2026-09-19T10:00:00.000Z',
    },
  ],
  retention: { delayed_evidence: 'not_evaluated', session_days: 7 },
};

describe('HistoryPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the student thought, disclosed help, and later independent evidence as one timeline', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    render(<MemoryRouter><HistoryPage username="小林" /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '学习证据时间线' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '二次函数最值' })).toBeInTheDocument();
    expect(screen.getByText('我当时怎么想')).toBeInTheDocument();
    expect(screen.getByText('看过：一点提示')).toBeInTheDocument();
    expect(screen.getByText('计划有依据，执行需要修正')).toBeInTheDocument();
    expect(document.querySelector('.history-shell .katex')).not.toBeNull();
    expect(screen.getByRole('link', { name: '继续原题' })).toHaveAttribute('href', '/study?session=12');
    expect(screen.getByRole('link', { name: '查看证据报告' })).toHaveAttribute('href', '/learn/12/report');
    expect(screen.queryByText(/掌握\s*\d+%/)).not.toBeInTheDocument();
  });

  it('recovers from a load failure without leaving the page stuck', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'failed' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...response, entries: [] }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }));

    render(<MemoryRouter><HistoryPage username="小林" /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取学习历史');
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByRole('heading', { name: '还没有可回看的学习记录' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
