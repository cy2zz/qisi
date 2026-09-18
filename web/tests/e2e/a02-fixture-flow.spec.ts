import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ user: { id: 'fixture-user', username: '视觉验收' } }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/analyze', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        analysis: {
          firstQuestion: '你准备先求导还是先观察函数图像？',
          keyConditions: ['函数为三次多项式'],
          knowledgePoints: ['导数', '单调性'],
          overview: '这是一道利用导数研究函数性质的题目。',
          target: '确定单调区间与极值。',
        },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/chat', async (route) => {
    await route.fulfill({
      body: [
        'event: status\ndata: {"message":"正在核对你的这一步"}',
        'event: chunk\ndata: {"text":"先求出导函数，"}',
        'event: chunk\ndata: {"text":"再判断它的正负区间。"}',
        'event: done\ndata: {}',
        '',
      ].join('\n\n'),
      contentType: 'text/event-stream',
      status: 200,
    });
  });
});

test('@A02 fixture-only chat workspace accepts local problems and formula input', async ({
  page,
}) => {
  await page.goto('/bank');

  await expect(page.getByRole('heading', { name: '今天想解决哪道题？' })).toBeVisible();
  await expect(page.locator('#history-title')).toHaveText('做题记录');

  const bodyFontFamily = await page.locator('body').evaluate(
    (body) => window.getComputedStyle(body).fontFamily,
  );
  expect(bodyFontFamily).toMatch(/^"?Microsoft YaHei"?/);

  if ((page.viewportSize()?.width ?? 0) > 720) {
    const desktopColumns = await page.locator('.study-chat-page').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(desktopColumns.split(' ')).toHaveLength(2);
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeHidden();
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
    await page.getByRole('button', { name: '关闭导航', exact: true }).click();
  }

  await page.getByRole('button', { name: '从本地题库选择' }).click();
  await expect(page.getByRole('dialog', { name: '本地题库' })).toBeVisible();
  await page.getByRole('button', { name: '选择 F-01 导数与函数' }).click();
  await expect(page.getByRole('heading', { name: '题目分析' })).toBeVisible();
  await expect(page.getByText('确定单调区间与极值。')).toBeVisible();

  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await editor.fill('先求导');
  await editor.selectText();
  await page.getByRole('button', { name: '加粗' }).click();
  await expect(editor.locator('strong, b')).toHaveText('先求导');
  await editor.fill('');

  await page.getByRole('button', { name: '公式' }).click();
  await page.getByRole('button', { name: '插入分式' }).click();
  await expect(editor).toHaveText('$\\frac{}{}$');

  await editor.fill('我准备先求导。');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先求出导函数，再判断它的正负区间。')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
  await editor.fill('临界点怎么找？');
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
