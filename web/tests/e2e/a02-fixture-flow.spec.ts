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
  await page.route('**/api/bank/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const paper = {
      examType: '高考',
      examYear: 2024,
      id: '41',
      introImageUrl: null,
      isOfficial: true,
      questionCount: 1,
      region: '北京',
      session: null,
      status: 'ready',
      subject: '数学',
      title: '2024年高考数学试卷（北京）',
      track: '综合',
      variant: '题目与解析',
    };
    const body = pathname.endsWith('/filters')
      ? { regions: ['北京'], tracks: ['综合'], years: [2024] }
      : pathname.endsWith('/papers/41')
        ? {
            ...paper,
            questions: [
              {
                id: '801',
                imageHeight: 425,
                imageWidth: 1600,
                number: 1,
                questionCode: '2024北京#01',
                questionImageUrl: 'https://example.test/question.png',
                statementMarkdown: null,
                status: 'ready',
              },
            ],
          }
        : { papers: [paper], total: 1 };

    await route.fulfill({
      body: JSON.stringify(body),
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

test('@A02 chat workspace opens the real paper picker and accepts formula input', async ({
  page,
}) => {
  await page.goto('/study');

  await expect(page.getByRole('heading', { name: '今天想解决哪道题？' })).toBeVisible();
  await expect(page.locator('#history-title')).toHaveText('做题记录');

  const bodyFontFamily = await page.locator('body').evaluate(
    (body) => window.getComputedStyle(body).fontFamily,
  );
  expect(bodyFontFamily).toMatch(/^"?Microsoft YaHei"?/);

  const isDesktop = (page.viewportSize()?.width ?? 0) > 720;
  if (isDesktop) {
    const desktopColumns = await page.locator('.study-chat-page').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(desktopColumns.split(' ')).toHaveLength(2);
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
    await expect(page.getByRole('link', { name: '题库' })).toHaveAttribute('href', '/bank');
  } else {
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeHidden();
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
    await expect(page.getByRole('link', { name: '题库' })).toHaveAttribute('href', '/bank');
    await page.getByRole('button', { name: '关闭导航', exact: true }).click();
  }

  if (!isDesktop) await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('link', { name: '题库' }).click();
  await expect(page.getByRole('heading', { name: '从题库选择' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '历年真题，按卷选题' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '题库选择工作区' })).toBeVisible();
  await expect(page.getByLabel('筛选试卷')).toHaveClass(/paper-picker-filters/);
  await expect(page.getByRole('complementary', { name: '试卷列表' })).toHaveClass(
    /paper-picker-papers/,
  );
  const standalonePaper = page.getByRole('region', { name: '试卷内容' });
  await expect(standalonePaper).toBeVisible();
  await expect(standalonePaper.getByRole('article', { name: '第 1 题' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '选择题号' })).toHaveCount(0);
  await expect(standalonePaper.getByRole('button', { name: '选择第 1 题' })).toBeVisible();
  const standaloneQuestionListDisplay = await standalonePaper.locator('ol').evaluate(
    (element) => window.getComputedStyle(element).display,
  );
  expect(standaloneQuestionListDisplay).toBe('block');
  const bankHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(bankHasHorizontalOverflow).toBe(false);
  if (!isDesktop) await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
  await expect(page.getByRole('link', { name: '题库' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: '当前对话' }).click();
  await expect(page.getByRole('heading', { name: '今天想解决哪道题？' })).toBeVisible();

  await page.getByRole('button', { name: '去题库选择' }).click();
  await expect(page.getByRole('dialog', { name: '从题库选择' })).toBeVisible();
  await expect(page.getByRole('region', { name: '试卷内容' })).toBeVisible();
  await expect(page.getByRole('article', { name: '第 1 题' })).toBeVisible();
  const questionListDisplay = await page.locator('.paper-picker-questions ol').evaluate(
    (element) => window.getComputedStyle(element).display,
  );
  expect(questionListDisplay).toBe('block');
  await page.getByRole('button', { name: '选择第 1 题' }).click();
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
