import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankPage } from './BankFlow';

const problemMd = '求不等式 $\\frac{x-1}{x-3}<0$ 的解集。';
const analysis = {
  firstQuestion: '先找出分界点。', keyConditions: ['分母不为零'],
  knowledgePoints: ['分式不等式'], overview: '合成测试题', target: '求解集',
};
interface ChatBody {
  expectedVersion: number;
  history: Array<{ content: string; role: string }>;
  message: string;
  requestId: string;
  sessionId: string;
}
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function streamResponse(body: string, split: boolean) {
  if (!split) return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  const encoder = new TextEncoder();
  const chunks = [body.slice(0, 13), body.slice(13, 49), body.slice(49)];
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

function mockSession({ split = false, initialError = false } = {}) {
  let version = 1;
  const bodies: ChatBody[] = [];
  const statuses: number[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const record = { id: '17', title: '合成分式不等式', content: problemMd, problemMd, version };
    if (url === '/api/learning/sessions') return jsonResponse({ sessions: [record] });
    if (url === '/api/learning/sessions/17') return jsonResponse({ record, analysis, draftMarkdown: '',
      messages: [{ id: 'analysis-17', content: '合成测试题', messageType: 'analysis', role: 'guide' }] });
    if (url.endsWith('/draft')) return jsonResponse({ savedAt: '2026-09-22T10:00:00.000Z' });
    if (url === '/api/problems/chat') {
      const body = JSON.parse(String(init?.body)) as ChatBody;
      bodies.push(body);
      if (body.expectedVersion !== version) {
        statuses.push(409);
        return jsonResponse({ message: 'learning session version changed; refresh before retrying' }, 409);
      }
      statuses.push(200);
      if (initialError && bodies.length === 1) {
        return streamResponse(frame('status', { message: '正在核对' })
          + frame('error', { message: '合成模型超时，请重试。' }), split);
      }
      version += 1;
      return streamResponse(frame('status', { message: '正在核对' })
        + frame('chunk', { text: `第${bodies.length}轮已核对的回复。` })
        + frame('done', { version }), split);
    }
    return jsonResponse({});
  });
  return { bodies, statuses };
}
async function openSession(strict: boolean) {
  const page = <MemoryRouter initialEntries={['/study?session=17']}><BankPage username="合成学生" /></MemoryRouter>;
  render(strict ? <StrictMode>{page}</StrictMode> : page);
  await screen.findByRole('heading', { name: '合成分式不等式' });
  const editor = screen.getByRole('textbox', { name: '输入题目或想法' });
  await waitFor(() => expect(editor).toHaveFocus());
  return editor;
}
function submit(editor: HTMLElement, content: string) {
  editor.textContent = content;
  fireEvent.input(editor);
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

describe('BankPage committed chat versions (real React + SSE parser, fixture server)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each([
    { name: 'one network chunk', split: false, strict: false },
    { name: 'split network chunks and StrictMode', split: true, strict: true },
  ])('sends server versions 1, 2, 3 for consecutive turns with $name', async ({ split, strict }) => {
    const server = mockSession({ split });
    const editor = await openSession(strict);
    const inputs = ['x=1和x=3', 'x=1让分子为0，x=3让分母为0，x=3不能取', '我再比较三个区间的符号'];
    for (const [index, content] of inputs.entries()) {
      submit(editor, content);
      await waitFor(() => expect(server.bodies).toHaveLength(index + 1));
      expect(server.bodies[index]?.expectedVersion).toBe(index + 1);
      await screen.findByText(`第${index + 1}轮已核对的回复。`);
      await waitFor(() => expect(screen.queryByRole('button', { name: '等待回复' })).not.toBeInTheDocument());
    }
    expect(server.statuses).toEqual([200, 200, 200]);
    expect(new Set(server.bodies.map((body) => body.requestId)).size).toBe(3);
    expect(server.bodies[1]?.history).toEqual(expect.arrayContaining([
      { role: 'student', content: inputs[0] },
      { role: 'guide', content: '第1轮已核对的回复。' },
    ]));
  });

  it('does not apply an old session completion version to the session opened meanwhile', async () => {
    let releaseFirst: (() => void) | undefined;
    const bodies: ChatBody[] = [];
    const records = [
      { id: '17', title: '合成分式不等式', content: problemMd, problemMd, version: 1 },
      { id: '18', title: '另一合成会话', content: problemMd, problemMd, version: 7 },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/learning/sessions') return jsonResponse({ sessions: records });
      const record = records.find((item) => url === `/api/learning/sessions/${item.id}`);
      if (record) return jsonResponse({ record, analysis, messages: [], draftMarkdown: '' });
      if (url === '/api/problems/chat') {
        const body = JSON.parse(String(init?.body)) as ChatBody;
        bodies.push(body);
        if (body.sessionId === '17') await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return streamResponse(frame('chunk', { text: `会话${body.sessionId}的已核对回复` })
          + frame('done', { version: body.sessionId === '17' ? 2 : 8 }), false);
      }
      return jsonResponse({});
    });
    const editor = await openSession(true);
    submit(editor, '第一会话的输入');
    await waitFor(() => expect(bodies).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /另一合成会话/ }));
    await screen.findByRole('heading', { name: '另一合成会话' });
    await act(async () => { releaseFirst?.(); });
    expect(screen.queryByText('会话17的已核对回复')).not.toBeInTheDocument();
    submit(editor, '第二会话的输入');
    await screen.findByText('会话18的已核对回复');
    expect(bodies[1]).toMatchObject({ sessionId: '18', expectedVersion: 7 });
  });

  it('does not invent a new version when a turn ends with error instead of done', async () => {
    const server = mockSession({ initialError: true });
    const editor = await openSession(true);
    submit(editor, 'x=1和x=3');
    await screen.findByText('合成模型超时，请重试。');
    submit(editor, '重新核对分界点');
    await screen.findByText('第2轮已核对的回复。');
    expect(server.bodies.map((body) => body.expectedVersion)).toEqual([1, 1]);
    expect(server.statuses).toEqual([200, 200]);
  });
});
