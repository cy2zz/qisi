import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://example.test/question.png', async (route) => {
    await route.fulfill({
      body: `
        <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="425" viewBox="0 0 1600 425">
          <rect width="1600" height="425" fill="#fffdf8"/>
          <line x1="72" y1="78" x2="1528" y2="78" stroke="#d8d2c5" stroke-width="2"/>
          <text x="72" y="54" fill="#2864dc" font-family="monospace" font-size="24" font-weight="700">2024 · BEIJING · QUESTION 01</text>
          <text x="72" y="151" fill="#18212b" font-family="serif" font-size="38">1. 已知集合 A={x | x²-3x+2≤0}，B={x | 1&lt;x&lt;3}。</text>
          <text x="72" y="221" fill="#18212b" font-family="serif" font-size="38">求 A∩B，并写出完整的区间表示。</text>
          <text x="72" y="324" fill="#66707a" font-family="sans-serif" font-size="26">请先独立判断边界点是否取到，再进入作答。</text>
        </svg>`,
      contentType: 'image/svg+xml',
      status: 200,
    });
  });
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
      questionCount: 3,
      region: '北京',
      session: null,
      status: 'ready',
      subject: '数学',
      title: '2024年高考数学试卷（北京）',
      track: '综合',
      variant: '题目与解析',
    };
    const question = {
      id: '801',
      imageHeight: 425,
      imageWidth: 1600,
      number: 1,
      questionCode: '2024北京#01',
      questionImageUrl: 'https://example.test/question.png',
      statementMarkdown: null,
      status: 'ready',
    };
    const questions = [
      question,
      {
        ...question,
        id: '802',
        number: 2,
        questionCode: '2024北京#02',
        questionImageUrl: null,
        statementMarkdown: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$。`,
      },
      {
        ...question,
        id: '803',
        number: 3,
        questionCode: '2024北京#03',
        questionImageUrl: null,
        statementMarkdown: String.raw`已知 $f'(x)=3x^2-3$，讨论 $f(x)$ 的单调性。`,
      },
    ];
    const scope = {
      bankVersion: 'exam-bank@2026-09-20T00:00:00.000Z',
      invalidCount: 0,
      needsReviewCount: 0,
      paperCount: 1,
      readyCount: 3,
      selectableCount: 3,
      totalCount: 3,
      unreadableCount: 0,
      updatedAt: '2026-09-20T00:00:00.000Z',
    };
    const body = pathname.endsWith('/filters')
      ? { regions: ['北京'], tracks: ['综合'], years: [2024] }
      : pathname.endsWith('/questions/random')
        ? { requestId: 'fixture-random-request', scope, selection: { paper, question } }
      : pathname.endsWith('/papers/41')
        ? {
            ...paper,
            questions,
          }
        : { papers: [paper], scope, total: 1 };

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
}, testInfo) => {
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
    const openNavigation = page.getByRole('button', { name: '打开导航' });
    await openNavigation.click();
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
    await expect(page.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused();
    await expect(page.getByRole('link', { name: '题库' })).toHaveAttribute('href', '/bank');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeHidden();
    await expect(openNavigation).toBeFocused();
  }

  if (!isDesktop) await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('link', { name: '题库' }).click();
  await expect(page.getByRole('heading', { name: '从题库选择' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '历年真题，按卷选题' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '题库选择工作区' })).toBeVisible();
  await expect(page.getByLabel('筛选试卷')).toHaveClass(/paper-picker-filters/);
  const standaloneScope = page.getByRole('region', { name: '当前抽题范围' });
  await expect(standaloneScope).toContainText('全部试卷');
  await expect(standaloneScope).toContainText('3 道可练习题');
  await expect(page.locator('.paper-bank-paper-panel .paper-picker-papers')).toHaveClass(
    /paper-picker-papers/,
  );
  const standalonePaper = page.getByRole('region', { name: '试卷内容' });
  await expect(standalonePaper).toBeVisible();
  await expect(standalonePaper.getByRole('article', { name: '第 1 题' })).toBeVisible();
  const questionNavigator = standalonePaper.getByRole('navigation', { name: '题号导航' });
  await expect(questionNavigator.getByRole('button')).toHaveCount(3);
  await questionNavigator.getByRole('button', { name: '跳到第 3 题' }).click();
  await expect(standalonePaper.getByRole('article', { name: '第 3 题' })).toBeFocused();
  await expect(standalonePaper.getByRole('article', { name: '第 3 题' })).toBeInViewport();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      path: `artifacts/acceptance/A02-question-navigator-${testInfo.project.name}.png`,
    });
  }
  await expect(standalonePaper.getByText('题面可读').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '选择题号' })).toHaveCount(0);
  await expect(standalonePaper.getByRole('button', { name: '选择第 1 题' })).toBeEnabled();
  const filterPanel = page.locator('.paper-bank-filter-panel');
  const paperPanel = page.locator('.paper-bank-paper-panel');
  if (!isDesktop) await filterPanel.locator('summary').click();
  await page.getByLabel('年份').selectOption('2024');
  await expect(page).toHaveURL(/\/bank\?year=2024$/);
  await expect(standaloneScope).toContainText('2024 年');
  if (!isDesktop) await filterPanel.locator('summary').click();
  await standaloneScope.getByRole('button', { name: '随机抽一道' }).click();
  await expect(standalonePaper.getByRole('article', { name: '第 1 题' })).toHaveAttribute(
    'data-random-target',
    'true',
  );
  await expect(standalonePaper.getByText('随机抽中', { exact: true })).toBeVisible();
  await expect(standalonePaper.getByRole('button', { name: '选择第 1 题' })).toBeEnabled();
  await expect(page).toHaveURL(
    /\/bank\/papers\/41\/questions\/801\?mode=random&year=2024$/,
  );
  await page.reload();
  await expect(standalonePaper.getByRole('article', { name: '第 1 题' })).toHaveAttribute(
    'data-random-target',
    'true',
  );
  await expect(standalonePaper.getByRole('article', { name: '第 1 题' })).toBeFocused();
  await expect(standalonePaper.getByText('随机抽中', { exact: true })).toBeVisible();
  await expect(standalonePaper.getByRole('button', { name: '选择第 1 题' })).toBeEnabled();
  const standaloneQuestionListDisplay = await standalonePaper.locator('ol').evaluate(
    (element) => window.getComputedStyle(element).display,
  );
  expect(standaloneQuestionListDisplay).toBe('block');
  if (isDesktop) {
    await expect(filterPanel).toHaveAttribute('open', '');
    await expect(paperPanel).toHaveAttribute('open', '');
  } else {
    await expect(filterPanel.locator('summary')).toBeVisible();
    await expect(filterPanel).not.toHaveAttribute('open', '');
    await expect(paperPanel.locator('summary')).toBeVisible();
    await expect(paperPanel).not.toHaveAttribute('open', '');
    await expect(standalonePaper.getByRole('button', { name: '选择第 1 题' })).toBeInViewport();
  }
  const bankHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(bankHasHorizontalOverflow).toBe(false);
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A02-bank-${testInfo.project.name}.png`,
    });
  }
  if (!isDesktop) await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
  await expect(page.getByRole('link', { name: '题库' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: '当前对话' }).click();
  await expect(page.getByRole('heading', { name: '今天想解决哪道题？' })).toBeVisible();

  await page.getByRole('button', { name: '去题库选择' }).click();
  await expect(page.getByRole('dialog', { name: '从题库选择' })).toBeVisible();
  const dialogScope = page.getByRole('dialog').getByRole('region', { name: '当前抽题范围' });
  await dialogScope.getByRole('button', { name: '随机抽一道' }).click();
  await expect(page.getByRole('region', { name: '试卷内容' })).toBeVisible();
  await expect(page.getByRole('article', { name: '第 1 题' })).toHaveAttribute(
    'data-random-target',
    'true',
  );
  await expect(page.getByRole('dialog').getByText('随机抽中', { exact: true })).toBeVisible();
  const questionListDisplay = await page.locator('.paper-picker-questions ol').evaluate(
    (element) => window.getComputedStyle(element).display,
  );
  expect(questionListDisplay).toBe('block');
  await page.getByRole('button', { name: '选择第 1 题' }).click();
  await expect(page.getByRole('heading', { name: '题目分析' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: '当前目标' }).getByText('确定单调区间与极值。'),
  ).toBeVisible();

  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await editor.fill('先圈出题图中的边界条件。');
  if (!isDesktop) await page.getByRole('button', { name: '展开题目' }).click();
  const imageReaderTrigger = page.getByRole('button', {
    name: '放大查看2024年高考数学试卷（北京）第 1 题',
  });
  await imageReaderTrigger.scrollIntoViewIfNeeded();
  await imageReaderTrigger.click();
  const imageReader = page.getByRole('dialog', {
    name: '题图阅读：2024年高考数学试卷（北京）第 1 题',
  });
  await expect(imageReader).toBeVisible();
  await expect(imageReader.getByText('适合窗口 · 100%')).toBeVisible();
  await expect(imageReader.getByRole('button', { name: '关闭题图阅读' })).toBeFocused();
  for (const action of await imageReader.getByRole('button').all()) {
    const size = await action.boundingBox();
    expect(size?.height).toBeGreaterThanOrEqual(44);
  }
  await imageReader.getByRole('button', { name: '放大题图' }).click();
  await expect(imageReader.getByText('放大阅读 · 125%')).toBeVisible();
  const imageCanvas = imageReader.locator('.math-image-viewer-canvas');
  await expect.poll(async () => imageCanvas.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  )).toBe(true);
  await page.keyboard.press('+');
  await expect(imageReader.getByText('放大阅读 · 150%')).toBeVisible();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      path: `artifacts/acceptance/A02-question-reader-${testInfo.project.name}.png`,
    });
  }
  await page.keyboard.press('0');
  await expect(imageReader.getByText('适合窗口 · 100%')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(imageReader).toBeHidden();
  await expect(imageReaderTrigger).toBeFocused();
  await expect(editor).toHaveText('先圈出题图中的边界条件。');

  await editor.fill('先求导');
  await editor.selectText();
  if (!isDesktop) {
    await page.getByRole('button', { name: '更多文字格式' }).click();
    await expect(page.getByRole('toolbar', { name: '文字格式' })).toBeVisible();
  }
  await page.getByRole('button', { name: '加粗' }).click();
  await expect(editor.locator('strong, b')).toHaveText('先求导');
  if (!isDesktop) await page.getByRole('button', { name: '更多文字格式' }).click();
  await editor.fill('');

  await page.getByRole('button', { name: '公式', exact: true }).click();
  const formulaPanel = page.getByRole('group', { name: '公式快捷输入' });
  await expect(formulaPanel.getByRole('button')).toHaveCount(13);
  if (!isDesktop) {
    const formulaToolbarLayout = await formulaPanel.locator('.formula-toolbar').evaluate(
      (element) => ({
        clientWidth: element.clientWidth,
        display: window.getComputedStyle(element).display,
        gridTemplateColumns: window.getComputedStyle(element).gridTemplateColumns,
        scrollWidth: element.scrollWidth,
      }),
    );
    expect(formulaToolbarLayout.display).toBe('grid');
    expect(formulaToolbarLayout.gridTemplateColumns.split(' ')).toHaveLength(6);
    expect(formulaToolbarLayout.scrollWidth).toBeLessThanOrEqual(
      formulaToolbarLayout.clientWidth + 1,
    );
    if (testInfo.project.name === 'h5-390') {
      await page.screenshot({
        path: 'artifacts/acceptance/A03-formula-shortcuts-h5-390.png',
      });
    }
  }
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

test('@A02 question image failure is explicit, compact, and retryable', async ({ page }) => {
  await page.route('https://example.test/question.png', async (route) => route.abort('failed'));
  await page.goto('/bank');

  const question = page.getByRole('article', { name: '第 1 题' });
  await expect(question.getByRole('alert')).toContainText('题图没有加载成功');
  await expect(question.getByText('题面需重试')).toBeVisible();
  await expect(question.getByRole('button', { name: '选择第 1 题' })).toBeDisabled();
  await expect(question.getByRole('button', { name: '重新加载第 1 题题图' })).toBeVisible();

  const cardHeight = await question.evaluate((element) => element.getBoundingClientRect().height);
  expect(cardHeight).toBeLessThan(420);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
