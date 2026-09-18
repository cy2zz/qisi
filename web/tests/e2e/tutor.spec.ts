// B03 教学页端到端用例。
//
// 覆盖 AT15 的实质（acceptance/cases.json，layer: e2e）：
//   Given 新会话
//   When  未请求帮助前打开学习页
//   Then  只展示题干与自主输入，不预先泄露完整步骤
//
// 另覆盖 StudentView 的信任边界在浏览器侧的实际表现：页面只渲染投影后的公开字段，
// 教学策略字段（entry_condition / acceptance_rule / expected_artifact / common_gaps /
// prerequisite_ids）与服务端私有的 rationale 均不得出现在 DOM 中。
//
// 全部 API 由 page.route 打桩，不依赖真实模型；playwright.config.ts 的 webServer
// 会自起 server 与 web。按 A 的既有约定，标题带 @B03 供 npm run test:e2e:task 选取。

import { expect, test } from '@playwright/test';

const SESSION_ID = 'fixture-session-b03';

/** 会话初始视图：只有题干与自主输入，没有任何帮助内容。 */
const initialView = {
  session_id: SESSION_ID,
  version: 1,
  phase: 'study',
  problem: {
    id: 'self-001',
    source: '自拟',
    is_official: false,
    statement_md: '讨论 $f(x)=x+\\frac{1}{x}$（$x>0$）的单调性与最小值。',
    asset_ids: [],
    status: 'ready',
    issues: [],
  },
  active_task_prompt_md: '讨论 $f(x)=x+\\frac{1}{x}$（$x>0$）的单调性与最小值。',
  messages: [],
  current_goal: {
    goal_key: 'self-001:d1',
    label: '说明这一项的求导依据',
    origin: 'teacher',
    status: 'in_progress',
  },
  attempt: null,
  notice: '',
  allowed_actions: ['attempt', 'hint', 'explain', 'worked_solution', 'finish_problem'],
  run_status: 'idle',
  can_start_check: false,
};

/** 提交一轮后：追加学生与老师两条消息，版本推进。 */
const afterTurnView = {
  ...initialView,
  version: 2,
  messages: [
    { id: 'student-1', role: 'student', text_md: '$f\'(x)=1+1/x^2$', created_at: '2026-09-18T00:00:00.000Z' },
    { id: 'teacher-1', role: 'teacher', text_md: '只看倒数项，你怎样说明它的求导依据？', created_at: '2026-09-18T00:00:01.000Z' },
  ],
};

test.beforeEach(async ({ page }) => {
  // App 把一切挡在鉴权之后：未登录只渲染登录页，故须先打桩身份。
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ user: { id: 'fixture-user', username: '视觉验收' } }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.route(`**/api/session/${SESSION_ID}`, async (route) => {
    await route.fulfill({ body: JSON.stringify(initialView), contentType: 'application/json', status: 200 });
  });

  await page.route('**/api/tutor/turn', async (route) => {
    await route.fulfill({ body: JSON.stringify(afterTurnView), contentType: 'application/json', status: 200 });
  });
});

test('@B03 新会话打开时只展示题干与自主输入', async ({ page }) => {
  await page.goto(`/learn/${SESSION_ID}`);

  // 题干可见，且公式经 KaTeX 渲染。
  await expect(page.getByRole('heading', { name: '题目' })).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.getByText('自拟题，非高考真题')).toBeVisible();

  // 自主输入可用——未被强制先看提示。
  const composer = page.getByRole('textbox', { name: '输入题目或想法' });
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();

  // 只有当前目标，且只有它的 label；没有更多目标被提前摊开。
  await expect(page.getByText('说明这一项的求导依据')).toBeVisible();
});

test('@B03 未请求帮助前不预先泄露完整步骤或策略字段', async ({ page }) => {
  await page.goto(`/learn/${SESSION_ID}`);

  // 明确的操作动作存在，但点击前不应出现任何解法内容。
  await expect(page.getByRole('button', { name: '提交我的这一步' })).toBeVisible();
  await expect(page.getByRole('button', { name: '直接讲完整解法' })).toBeVisible();

  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  // 教学策略字段一旦出现在 DOM，等于把完整路线与评分口径交给学生。
  for (const leaked of ['entry_condition', 'acceptance_rule', 'expected_artifact', 'common_gaps', 'prerequisite_ids', 'rationale']) {
    expect(bodyText, `页面泄露了私有字段名 ${leaked}`).not.toContain(leaked);
  }

  // 未请求帮助时，老师消息应为零条。
  await expect(page.locator('ol > li')).toHaveCount(0);
});

test('@B03 提交一步后显示老师的回应', async ({ page }) => {
  await page.goto(`/learn/${SESSION_ID}`);

  const composer = page.getByRole('textbox', { name: '输入题目或想法' });
  await composer.fill("f'(x)=1+1/x^2");
  await page.getByRole('button', { name: '提交我的这一步' }).click();

  await expect(page.getByText('只看倒数项，你怎样说明它的求导依据？')).toBeVisible();
  await expect(page.getByText('v2')).toBeVisible();
});

test('@B03 无横向溢出，H5 与 PC 均可读', async ({ page }) => {
  await page.goto(`/learn/${SESSION_ID}`);
  await expect(page.getByRole('heading', { name: '题目' })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test('@B03 会话读取接口缺失时给出可行动说明，而非白屏', async ({ page }) => {
  // loadSession 归 A 且尚未交付：404 是当前阶段的预期结果，
  // 页面必须说清楚，而不是留一片空白让人猜。
  await page.route(`**/api/session/${SESSION_ID}`, async (route) => {
    await route.fulfill({ body: JSON.stringify({ message: 'not found' }), contentType: 'application/json', status: 404 });
  });

  await page.goto(`/learn/${SESSION_ID}`);

  await expect(page.getByRole('heading', { name: '无法打开这个学习会话' })).toBeVisible();
  await expect(page.getByText(/loadSession/)).toBeVisible();
});
