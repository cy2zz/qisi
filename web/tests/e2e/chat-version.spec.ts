// B07连续chat版本回归：真实浏览器/React/SSE parser；所有API为合成fixture，不触达业务库/模型。
import { expect, test } from '@playwright/test';

const problemMd = '求不等式 $\\frac{x-1}{x-3}<0$ 的解集。';
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test('@B07 three consecutive chats use the committed version and survive page reload', async ({ page }) => {
  let version = 1;
  const versions: number[] = [];
  const requests: string[] = [];
  const analysis = { overview: '合成题目分析', firstQuestion: '找分界点。', keyConditions: ['分母非零'],
    knowledgePoints: ['分式不等式'], target: '求解集' };
  const messages: Array<{ id: string; role: string; messageType: string; content: string }> = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Intercept every API path so the fixture cannot accidentally write to the running business DB.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const record = { id: '17', title: '合成分式不等式', content: problemMd, problemMd, version };
    const fulfill = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/me') return fulfill({ user: { id: 'synthetic-b07', username: '连续作答测试' } });
    if (path === '/api/learning/sessions') return fulfill({ sessions: [record] });
    if (path === '/api/learning/sessions/17') return fulfill({ record, analysis, messages, draftMarkdown: '' });
    if (path.endsWith('/draft')) return fulfill({ savedAt: '2026-09-22T10:00:00.000Z' });
    if (path === '/api/problems/chat') {
      const body = route.request().postDataJSON() as { expectedVersion: number; requestId: string; message: string };
      versions.push(body.expectedVersion); requests.push(body.requestId);
      if (body.expectedVersion !== version) return fulfill({ message: 'learning session version changed; refresh before retrying' }, 409);
      version += 1;
      const reply = `第${versions.length}轮合成核对已完成。`;
      messages.push({ id: `s-${version}`, role: 'student', messageType: 'text', content: body.message },
        { id: `g-${version}`, role: 'guide', messageType: 'text', content: reply });
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body:
        frame('status', { message: '正在核对' }) + frame('chunk', { text: reply }) + frame('done', { version }) });
    }
    return fulfill({ message: 'unregistered fixture route' }, 404);
  });
  await page.goto('/study?session=17');
  await expect(page.getByRole('heading', { name: '合成分式不等式' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  const inputs = ['x=1和x=3', 'x=1让分子为0，x=3让分母为0，x=3不能取', '我接着比较三个区间的符号'];
  for (const [index, message] of inputs.entries()) {
    await editor.fill(message);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText(`第${index + 1}轮合成核对已完成。`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '等待回复', exact: true })).toHaveCount(0);
  }
  expect(versions).toEqual([1, 2, 3]);
  expect(new Set(requests).size).toBe(3);
  await page.reload();
  await expect(page.getByText('第3轮合成核对已完成。', { exact: true })).toBeVisible();
  await editor.fill('刷新后继续讨论');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('第4轮合成核对已完成。', { exact: true })).toBeVisible();
  expect(versions).toEqual([1, 2, 3, 4]);
  expect(errors).toEqual([]);
});
