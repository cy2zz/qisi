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
    expect(screen.getAllByText('计划有依据，执行需要修正')).toHaveLength(2);
    expect(document.querySelector('.history-shell .katex')).not.toBeNull();
    expect(screen.getByRole('link', { name: '查看证据报告' })).toHaveAttribute('href', '/learn/12/report');
    expect(screen.getByRole('link', { name: '回学习页处理执行卡点' })).toHaveAttribute(
      'href',
      '/study?session=12&remediate=execution',
    );
    expect(screen.queryByText(/掌握\s*\d+%/)).not.toBeInTheDocument();
  });

  it('keeps the latest record open and makes older evidence scannable before expansion', async () => {
    const latestEntry = response.entries[0];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ...response,
        entries: [
          latestEntry,
          {
            ...latestEntry,
            session_id: '11',
            title: '较早的函数练习',
            topic: '函数',
            updated_at: '2026-09-18T08:00:00.000Z',
          },
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    render(<MemoryRouter><HistoryPage username="小林" /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '二次函数最值' })).toBeInTheDocument();
    const disclosures = document.querySelectorAll<HTMLDetailsElement>('.history-entry-disclosure');
    expect(disclosures).toHaveLength(2);
    expect(disclosures[0].open).toBe(true);
    expect(disclosures[1].open).toBe(false);

    const olderSummary = disclosures[1].querySelector('summary');
    expect(olderSummary).not.toBeNull();
    expect(olderSummary).toHaveTextContent('较早的函数练习');
    expect(olderSummary).toHaveTextContent('原题作答有依据，使用过帮助');
    expect(olderSummary).toHaveTextContent('计划有依据，执行需要修正');
    expect(olderSummary).toHaveTextContent('方法不用推倒重来，只修执行卡点');
    expect(olderSummary).toHaveTextContent('展开详情');

    fireEvent.click(olderSummary!);
    expect(disclosures[1].open).toBe(true);
    await waitFor(() => expect(olderSummary).toHaveTextContent('收起详情'));
    expect(disclosures[1]).toHaveTextContent('我当时怎么想');
    expect(disclosures[1]).toHaveTextContent('看过：一点提示');
    expect(disclosures[1].querySelector('a[href="/learn/11/report"]')).not.toBeNull();
  });

  it('uses the same next-action rule for unfinished, method, evidence, and passed attempts', async () => {
    const baseEntry = response.entries[0];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ...response,
        entries: [
          {
            ...baseEntry,
            assessment: { ...baseEntry.assessment, phase: 'check_answer' },
            session_id: '21',
            title: '检验尚未完成',
          },
          {
            ...baseEntry,
            assessment: {
              ...baseEntry.assessment,
              execution: 'incorrect',
              phase: 'summary',
              planning: 'incorrect',
            },
            session_id: '22',
            title: '方法需要修正',
          },
          {
            ...baseEntry,
            assessment: {
              ...baseEntry.assessment,
              assistance_requested: true,
              execution: 'correct',
              phase: 'summary',
              planning: 'correct',
            },
            session_id: '23',
            title: '证据边界待确认',
          },
          {
            ...baseEntry,
            assessment: {
              ...baseEntry.assessment,
              execution: 'correct',
              independent_task_pass: true,
              phase: 'summary',
              planning: 'correct',
            },
            session_id: '24',
            title: '近迁移已通过',
          },
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    render(<MemoryRouter><HistoryPage username="小林" /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '检验尚未完成' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '继续当前独立检验' })).toHaveAttribute(
      'href',
      '/learn/21/check',
    );
    expect(screen.getByRole('link', { name: '回学习页梳理方法' })).toHaveAttribute(
      'href',
      '/study?session=22&remediate=method',
    );
    expect(screen.getByRole('link', { name: '查看证据边界' })).toHaveAttribute(
      'href',
      '/study?session=23&remediate=evidence',
    );
    expect(screen.getByRole('link', { name: '再测一道不同新题' })).toHaveAttribute(
      'href',
      '/learn/24/check?intent=reassess',
    );
    expect(screen.queryByText(/已经掌握|掌握率|\d+%/)).not.toBeInTheDocument();
  });

  it('keeps an unchecked original problem out of independent assessment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ...response,
        entries: [{
          ...response.entries[0],
          assessment: null,
          original_status: 'incomplete',
          session_id: '13',
          title: '仍需修正的根式题',
        }],
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    render(<MemoryRouter><HistoryPage username="小林" /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '仍需修正的根式题' })).toBeInTheDocument();
    expect(screen.getByText('原题结论仍需要修正')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /独立检验/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回原题修正结论' })).toHaveAttribute(
      'href',
      '/study?session=13',
    );
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
