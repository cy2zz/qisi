import { expect, test } from '@playwright/test';

const analysis = {
  firstQuestion: String.raw`要让分母 $\sqrt{3}$ 变成有理数，可以同时乘什么？`,
  keyConditions: [
    String.raw`原式为 $\frac{\sqrt{2}}{\sqrt{3}}$`,
    String.raw`分母含有根式 $\sqrt{3}$`,
  ],
  knowledgePoints: ['二次根式', '分母有理化'],
  overview: '这是一道根式化简题，当前只需要判断分母有理化所需的因式。',
  target: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$，使分母不含根号。`,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ user: { id: 'fixture-user', username: '响应式验收' } }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/analyze', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ analysis }),
      contentType: 'application/json',
      status: 200,
    });
  });
});

test('@B03 guarded learning flow keeps every core action reachable', async ({ page }, testInfo) => {
  let chatRequestCount = 0;
  let postedAssistanceMode: string | undefined;
  await page.route('**/api/problems/chat', async (route) => {
    chatRequestCount += 1;
    const body = route.request().postDataJSON() as { assistanceMode?: string };
    postedAssistanceMode = body.assistanceMode;
    const reply = body.assistanceMode === 'finish_problem'
      ? String.raw`当前结论需要修正：你提交的 $\frac{2}{3}$ 与题目的根式不一致。先检查分子是否仍应含根号。`
      : String.raw`先观察原式 \\[ \\frac{\\sqrt2}{\\sqrt3} \\]：分母是根式。想一想，什么因式能让它们的乘积成为有理数？`;
    await route.fulfill({
      body: [
        'event: status\ndata: {"message":"正在核对你的这一步"}',
        'event: status\ndata: {"message":"正在检查回复是否符合帮助深度"}',
        `event: chunk\ndata: ${JSON.stringify({ text: reply })}`,
        'event: done\ndata: {}',
        '',
      ].join('\n\n'),
      contentType: 'text/event-stream',
      status: 200,
    });
  });

  await page.goto('/study');
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await editor.fill('根号2除以根号3怎么化简？');
  await expect(editor).toHaveText('根号2除以根号3怎么化简？');
  const send = page.getByRole('button', { name: '发送' });
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByRole('heading', { name: '题目分析' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: '当前目标' }).getByText('使分母不含根号。'),
  ).toBeVisible();
  await expect(page.getByText('化简结果是')).toHaveCount(0);
  await expect(page.getByText('$\\frac{\\sqrt{6}}{3}$')).toHaveCount(0);

  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 0) <= 720;
  let expandedProblemWidth: number | undefined;
  if (isMobile) {
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeHidden();
    const problemSheet = await page.getByRole('complementary', { name: '题目原文' }).boundingBox();
    expect(problemSheet).not.toBeNull();
    expect(problemSheet!.height).toBeLessThanOrEqual((viewport?.height ?? 844) * 0.31);
  } else {
    const columns = await page.locator('.study-workbench').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(columns.split(' ')).toHaveLength(2);
    expandedProblemWidth = (await page.getByRole('complementary', { name: '题目原文' }).boundingBox())?.width;
  }

  const collapseButton = page.getByRole('button', { name: '收起题目' });
  await expect(collapseButton).toBeVisible();
  if (isMobile) {
    const targetSize = await collapseButton.boundingBox();
    expect(targetSize?.height).toBeGreaterThanOrEqual(44);
  }
  await collapseButton.click();
  await expect(page.getByRole('button', { name: '展开题目' })).toBeVisible();
  await expect(page.getByLabel('题目正文')).toHaveCount(0);
  if (!isMobile) {
    expect(expandedProblemWidth).toBeDefined();
    await expect.poll(async () => (
      await page.getByRole('complementary', { name: '题目原文' }).boundingBox()
    )?.width).toBeLessThan(expandedProblemWidth! * 0.75);
    const workbenchWidth = (await page.locator('.study-workbench').boundingBox())?.width;
    expect(workbenchWidth).toBeDefined();
    await expect.poll(async () => (
      await page.getByRole('region', { name: '思路训练区' }).boundingBox()
    )?.width).toBeGreaterThan(workbenchWidth! * 0.7);
  }

  await page.getByRole('button', { name: '提示一点' }).click();
  const hintLabel = page.getByLabel('帮助深度：最小提示');
  await expect(hintLabel).toBeVisible();
  const guardedReply = page.locator('.chat-message-guide').filter({ has: hintLabel });
  await expect(guardedReply.locator('.katex').first()).toBeVisible();
  await expect(guardedReply.locator('.katex-error')).toHaveCount(0);
  expect(postedAssistanceMode).toBe('hint');
  expect(chatRequestCount).toBe(1);
  await expect(page.getByText('最终答案')).toHaveCount(0);

  const help = page.getByRole('group', { name: '学习帮助' });
  await expect(help).toBeVisible();
  for (const label of ['我不知道从哪开始', '给一点提示', '解释当前卡点', '直接讲清楚']) {
    const action = help.getByRole('button', { name: label });
    await expect(action).toBeAttached();
    if (isMobile) {
      const size = await action.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
  }
  const finishAction = page.getByRole('button', { name: '核对本题结论' });
  await expect(finishAction).toBeVisible();
  if (isMobile) {
    const size = await finishAction.boundingBox();
    expect(size?.height).toBeGreaterThanOrEqual(44);
  }
  await finishAction.click();
  await expect(page.getByRole('status', { name: '本题结论提交方式' })).toContainText(
    '最终结论和关键一步',
  );
  await expect(editor).toBeFocused();
  await page.getByRole('button', { name: '改为普通作答' }).click();
  await expect(page.getByRole('status', { name: '本题结论提交方式' })).toHaveCount(0);
  expect(chatRequestCount).toBe(1);
  const directExplanation = help.getByRole('button', { name: '直接讲清楚' });
  await directExplanation.click();
  const disclosure = page.getByRole('alertdialog', { name: '要直接讲解这一步吗' });
  await expect(disclosure).toBeVisible();
  const continueExplanation = disclosure.getByRole('button', { name: '继续直接讲解' });
  await expect(continueExplanation).toBeFocused();
  if (isMobile) {
    for (const action of await disclosure.getByRole('button').all()) {
      const size = await action.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(chatRequestCount).toBe(1);
  await disclosure.getByRole('button', { name: '先自己做' }).click();
  await expect(disclosure).toBeHidden();
  await expect(editor).toBeFocused();

  await directExplanation.click();
  await page.getByRole('button', { name: '继续直接讲解' }).click();
  await expect(page.getByLabel('帮助深度：直接讲解')).toBeVisible();
  expect(postedAssistanceMode).toBe('worked_solution');
  expect(chatRequestCount).toBe(2);
  if (isMobile) {
    const actionsFitWithoutClipping = await help.locator('> div:last-child').evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    );
    expect(actionsFitWithoutClipping).toBe(true);
    await expect(help.locator('.help-action-short')).toHaveCount(4);
    for (const label of await help.locator('.help-action-short').all()) {
      await expect(label).toBeVisible();
    }
    for (const label of await help.locator('.help-action-long').all()) {
      await expect(label).toBeHidden();
    }
  }

  for (const label of ['添加题目图片', '题库', '公式', '公式转换', '长语音', '实时语音', '发送']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeAttached();
  }
  if (isMobile) {
    const compactTools = page.locator('.composer-actions > div:first-child > button');
    await expect(compactTools).toHaveCount(4);
    await expect(page.locator('.composer-action-label, .composer-format-label')).toHaveCount(4);
    for (const button of await compactTools.all()) {
      const size = await button.boundingBox();
      expect(size?.width).toBeGreaterThanOrEqual(44);
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
    for (const label of await page.locator('.composer-action-label, .composer-format-label').all()) {
      await expect(label).toBeHidden();
    }
  }
  await page.getByRole('button', { name: '公式', exact: true }).click();
  const fractionButton = page.getByRole('button', { name: '插入分式' });
  await expect(fractionButton).toBeVisible();
  await fractionButton.click();
  await editor.pressSequentially('2');
  if (isMobile) {
    await page.getByRole('button', { name: '移动到下一个公式输入格' }).click();
  } else {
    await editor.press('Tab');
  }
  await editor.pressSequentially('3');
  await expect(editor).toHaveText(String.raw`$\frac{2}{3}$`);
  await expect(page.getByLabel('公式预览').locator('.katex')).toBeVisible();
  const formulaTools = page.getByRole('group', { name: '公式快捷输入' });
  const lastFormulaShortcut = formulaTools.getByRole('button', { name: '插入联立式' });
  await expect(lastFormulaShortcut).toBeAttached();
  await lastFormulaShortcut.scrollIntoViewIfNeeded();
  await expect(lastFormulaShortcut).toBeVisible();
  await formulaTools.locator('.formula-toolbar').evaluate((element) => {
    element.scrollLeft = 0;
  });
  await finishAction.click();
  await expect(page.getByLabel('核对状态：本题结论')).toBeVisible();
  const checkpointNote = page.getByRole('note', { name: '本题核对说明' });
  await expect(checkpointNote).toContainText('掌握情况尚未独立验证');
  await expect(checkpointNote).toContainText('本题作答已核对');
  await expect(checkpointNote).toContainText('帮助记录已使用：最小提示、直接讲解');
  await expect(checkpointNote).toContainText('独立检验尚未进行');
  await expect(page.getByText('当前结论需要修正')).toBeVisible();
  await expect(page.getByText('已经掌握')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '公式快捷输入' })).toHaveCount(0);
  const finishReply = page.locator('.chat-message-guide').filter({
    has: page.getByLabel('核对状态：本题结论'),
  });
  const replyBox = await finishReply.locator('.math-markdown').boundingBox();
  const scrollBox = await page.locator('.chat-scroll').boundingBox();
  expect(replyBox).not.toBeNull();
  expect(scrollBox).not.toBeNull();
  expect(replyBox!.y).toBeGreaterThanOrEqual(scrollBox!.y - 1);
  expect(replyBox!.y).toBeLessThan(scrollBox!.y + scrollBox!.height);
  await expect(editor).toBeFocused();
  expect(postedAssistanceMode).toBe('finish_problem');
  expect(chatRequestCount).toBe(3);

  const composer = await page.locator('.composer-dock').boundingBox();
  expect(composer).not.toBeNull();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual((viewport?.height ?? 900) + 1);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/B03-learning-${testInfo.project.name}.png`,
    });
  }
});

test('@B03 failed help request is not presented as exposed help', async ({ page }) => {
  await page.route('**/api/problems/chat', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ message: 'provider unavailable' }),
      contentType: 'application/json',
      status: 503,
    });
  });

  await page.goto('/study');
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await editor.fill('根号2除以根号3怎么化简？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('heading', { name: '题目分析' })).toBeVisible();

  await page.getByRole('button', { name: '提示一点' }).click();
  await expect(page.getByText('暂时无法回应这一步。你的内容已经保留，可以重试。')).toBeVisible();
  await expect(page.getByLabel('帮助深度：最小提示')).toHaveCount(0);
  await expect(page.getByLabel('帮助状态：已请求，尚未发出')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新回答' })).toBeVisible();
});
