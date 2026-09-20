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
      body: JSON.stringify({
        analysis,
        session: { id: '12', title: '二次根式的化简', version: 1 },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions/*/draft', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ savedAt: '2026-09-20T00:00:01.000Z' }),
      contentType: 'application/json',
      status: 200,
    });
  });
});

test('@B03 guarded learning flow keeps every core action reachable', async ({ page }, testInfo) => {
  let chatRequestCount = 0;
  let finishRequestCount = 0;
  let postedAssistanceMode: string | undefined;
  await page.route('**/api/problems/chat', async (route) => {
    chatRequestCount += 1;
    const body = route.request().postDataJSON() as { assistanceMode?: string };
    postedAssistanceMode = body.assistanceMode;
    if (body.assistanceMode === 'finish_problem') finishRequestCount += 1;
    const currentVerdict = body.assistanceMode === 'finish_problem'
      ? finishRequestCount === 1 ? 'incorrect' : 'correct'
      : undefined;
    const reply = body.assistanceMode === 'finish_problem'
      ? finishRequestCount === 1
        ? String.raw`当前结论需要修正：你提交的 $\frac{2}{3}$ 与题目的根式不一致。先检查分子是否仍应含根号。`
        : String.raw`当前结论有依据：$\frac{\sqrt{2}}{\sqrt{3}}=\frac{\sqrt{6}}{3}$。`
      : String.raw`有依据：你可以从“分母不能含根号”的化简思路入手。
试着把 \[ \frac{\sqrt2}{\sqrt3} ] 的分子分母同时乘以 (\sqrt3)：[ \frac{\sqrt2}{\sqrt3}\times \frac{\sqrt3}{\sqrt3} \]
你先算一下：分子变成什么？分母变成什么？`;
    await route.fulfill({
      body: [
        'event: status\ndata: {"message":"正在核对你的这一步"}',
        'event: status\ndata: {"message":"正在检查回复是否符合帮助深度"}',
        `event: chunk\ndata: ${JSON.stringify({ text: reply })}`,
        `event: done\ndata: ${JSON.stringify({ currentVerdict })}`,
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
  const analysisBrief = page.locator('.analysis-brief');
  await expect(analysisBrief).toHaveAttribute('aria-label', '题面提要');
  await expect(analysisBrief).not.toHaveAttribute('open', '');
  await expect(page.getByText('要让分母', { exact: false })).toBeVisible();
  await expect(analysisBrief.locator('.analysis-overview')).toBeHidden();
  await analysisBrief.locator('summary').click();
  await expect(analysisBrief).toHaveAttribute('open', '');
  await expect(analysisBrief.locator('.analysis-overview')).toBeVisible();
  await analysisBrief.locator('summary').click();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/B03-analysis-focus-${testInfo.project.name}.png`,
    });
  }
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
    await expect(page.getByRole('button', { name: '展开题目' })).toBeVisible();
    await expect(page.getByLabel('题目正文')).toHaveCount(0);
    await expect(page.getByRole('group', { name: '快捷回应' })).toBeInViewport();
    const problemSheet = await page.getByRole('complementary', { name: '题目原文' }).boundingBox();
    expect(problemSheet).not.toBeNull();
    expect(problemSheet!.height).toBeLessThanOrEqual((viewport?.height ?? 844) * 0.22);
  } else {
    await expect(page.getByRole('button', { name: '收起题目' })).toBeVisible();
    const columns = await page.locator('.study-workbench').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(columns.split(' ')).toHaveLength(2);
    expandedProblemWidth = (await page.getByRole('complementary', { name: '题目原文' }).boundingBox())?.width;
  }

  await editor.fill('先标记题目中的关键条件。');
  await page.getByRole('button', { name: '专注读题' }).click();
  await expect(page.locator('.study-workbench')).toHaveAttribute('data-question-focus', 'true');
  await expect(page.getByRole('region', { name: '思路训练区' })).toBeHidden();
  await expect(page.getByLabel('题目正文')).toBeVisible();
  await expect(page.locator('.rich-composer-editor')).toHaveText('先标记题目中的关键条件。');
  if (isMobile) {
    const focusedQuestion = await page.getByRole('complementary', { name: '题目原文' }).boundingBox();
    expect(focusedQuestion?.height).toBeGreaterThan((viewport?.height ?? 844) * 0.6);
  }
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/B03-question-focus-${testInfo.project.name}.png`,
    });
  }
  await page.getByRole('button', { name: '返回作答' }).click();
  await expect(page.getByRole('region', { name: '思路训练区' })).toBeVisible();
  await expect(editor).toHaveText('先标记题目中的关键条件。');
  await editor.fill('');

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
    await expect(page.getByRole('region', { name: '折叠题目摘要' })).toBeVisible();
    expect(expandedProblemWidth).toBeDefined();
    await expect.poll(async () => (
      await page.getByRole('complementary', { name: '题目原文' }).boundingBox()
    )?.width).toBeLessThan(expandedProblemWidth! * 0.75);
    await expect.poll(async () => (
      await page.getByRole('complementary', { name: '题目原文' }).boundingBox()
    )?.width).toBeLessThanOrEqual(220);
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
  await expect(guardedReply.locator('.katex')).toHaveCount(3);
  await expect(guardedReply.locator('.katex').first()).toBeVisible();
  await expect(guardedReply.locator('.katex-error')).toHaveCount(0);
  const literalTextOutsideMath = await guardedReply.locator('.math-markdown').first().evaluate(
    (element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.katex').forEach((math) => math.remove());
      return clone.textContent ?? '';
    },
  );
  expect(literalTextOutsideMath).not.toContain('\\frac');
  expect(literalTextOutsideMath).not.toContain('\\sqrt');
  await expect(editor).toBeFocused();
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
  const locateStuckPoint = help.getByRole('button', { name: '先标记卡点，仅填入输入框' });
  await expect(locateStuckPoint).toBeVisible();
  await locateStuckPoint.click();
  const stuckPointOptions = page.getByRole('group', { name: '卡点类型' });
  await expect(stuckPointOptions).toContainText('先选最接近的一类');
  for (const label of ['条件没看懂', '方法想不到', '公式不会列', '计算卡住', '答案不确定']) {
    const option = stuckPointOptions.getByRole('button', { name: label });
    await expect(option).toBeAttached();
    if (isMobile) {
      const size = await option.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
  }
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/B03-stuck-locator-${testInfo.project.name}.png`,
    });
  }
  if (isMobile) {
    const lastStuckPoint = stuckPointOptions.getByRole('button', { name: '答案不确定' });
    await lastStuckPoint.scrollIntoViewIfNeeded();
    await expect(lastStuckPoint).toBeVisible();
  }
  await stuckPointOptions.getByRole('button', { name: '方法想不到' }).click();
  await expect(editor).toContainText('我卡在方法选择：我不知道应该先用哪个知识点。');
  await expect(stuckPointOptions).toHaveCount(0);
  expect(chatRequestCount).toBe(1);
  await editor.fill('');
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
  await page.keyboard.press('Shift+Tab');
  await expect(disclosure.getByRole('button', { name: '先自己做' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(continueExplanation).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(disclosure).toBeHidden();
  await expect(editor).toBeFocused();

  await directExplanation.click();
  await page.getByRole('button', { name: '继续直接讲解' }).click();
  await expect(page.getByLabel('帮助深度：直接讲解')).toBeVisible();
  await expect(editor).toBeFocused();
  expect(postedAssistanceMode).toBe('worked_solution');
  expect(chatRequestCount).toBe(2);
  if (isMobile) {
    const actionsFitWithoutClipping = await help.locator('> div:last-child').evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    );
    expect(actionsFitWithoutClipping).toBe(true);
    await expect(help.locator('.help-action-short')).toHaveCount(5);
    for (const label of await help.locator('.help-action-short').all()) {
      await expect(label).toBeVisible();
    }
    for (const label of await help.locator('.help-action-long').all()) {
      await expect(label).toBeHidden();
    }
  }

  for (const label of ['添加手写作答', '题库', '公式', '公式转换', '长语音', '实时语音', '发送']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeAttached();
  }
  const textFormatting = page.getByRole('toolbar', { name: '文字格式' });
  const textFormattingToggle = page.getByRole('button', { name: '更多文字格式' });
  if (isMobile) {
    await expect(textFormattingToggle).toBeVisible();
    await expect(textFormattingToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(textFormatting).toBeHidden();
    const toggleSize = await textFormattingToggle.boundingBox();
    expect(toggleSize?.width).toBeGreaterThanOrEqual(44);
    expect(toggleSize?.height).toBeGreaterThanOrEqual(44);

    const compactComposer = await page.locator('.chat-composer').boundingBox();
    expect(compactComposer).not.toBeNull();
    expect(compactComposer!.height).toBeLessThanOrEqual(150);

    await textFormattingToggle.click();
    await expect(textFormattingToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(textFormatting).toBeVisible();
    for (const button of await textFormatting.getByRole('button').all()) {
      const size = await button.boundingBox();
      expect(size?.width).toBeGreaterThanOrEqual(44);
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
    await textFormattingToggle.click();
    await expect(textFormatting).toBeHidden();

    const regularViewport = page.viewportSize();
    expect(regularViewport).not.toBeNull();
    await page.setViewportSize({ width: regularViewport!.width, height: 560 });
    await editor.focus();
    await expect(editor).toBeFocused();
    await expect(editor).toBeInViewport();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    const keyboardDock = await page.locator('.composer-dock').boundingBox();
    expect(keyboardDock).not.toBeNull();
    expect(keyboardDock!.y + keyboardDock!.height).toBeLessThanOrEqual(560 + 1);

    await page.getByRole('button', { name: '公式', exact: true }).click();
    await expect(page.getByRole('group', { name: '公式快捷输入' })).toBeInViewport();
    await expect(help).toBeHidden();
    await expect(finishAction).toBeHidden();
    await expect(editor).toBeInViewport();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    if (testInfo.project.name === 'h5-390') {
      await page.screenshot({
        path: 'artifacts/acceptance/B03-composer-keyboard-h5-390.png',
      });
    }
    await page.getByRole('button', { name: '公式', exact: true }).click();
    await expect(help).toBeVisible();
    await expect(finishAction).toBeVisible();
    await page.setViewportSize(regularViewport!);

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
  } else {
    await expect(textFormattingToggle).toBeHidden();
    await expect(textFormatting).toBeVisible();
  }

  if (isMobile) {
    await textFormattingToggle.click();
    await expect(textFormatting).toBeVisible();
  }
  const answerStructureTools = textFormatting.getByRole('group', { name: '作答结构' });
  const proofStructure = answerStructureTools.getByRole('button', { name: '插入证明结构' });
  const chatRequestsBeforeStructure = chatRequestCount;
  await proofStructure.click();
  await expect(editor).toContainText('要证：');
  await expect(editor).toContainText('依据：');
  await expect(editor).toContainText('结论：');
  await expect(editor).toBeFocused();
  await expect(page.locator('.composer-wrap')).toHaveAttribute('data-multistep', 'true');
  expect(chatRequestCount).toBe(chatRequestsBeforeStructure);
  if (isMobile) await expect(textFormatting).toBeHidden();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      path: `artifacts/acceptance/B03-proof-structure-${testInfo.project.name}.png`,
    });
  }
  await editor.fill('');

  const formulaTrigger = page.getByRole('button', { name: '公式', exact: true });
  const formulaTools = page.getByRole('group', { name: '公式快捷输入' });
  await formulaTrigger.focus();
  await formulaTrigger.press('Enter');
  const fractionButton = page.getByRole('button', { name: '插入分式' });
  await expect(fractionButton).toBeVisible();
  await expect(fractionButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(formulaTools).toHaveCount(0);
  await expect(formulaTrigger).toBeFocused();
  await formulaTrigger.click();
  await fractionButton.click();
  await editor.pressSequentially('2');
  if (isMobile) {
    await page.getByRole('button', { name: '移动到下一个公式输入格' }).click();
  } else {
    await editor.press('Tab');
  }
  await editor.pressSequentially('3');
  await expect(editor).toHaveText(String.raw`$\frac{2}{3}$`);
  await expect(page.getByLabel('公式预览').locator('.katex').first()).toBeVisible();
  await editor.fill('');
  const multistepTemplate = formulaTools.getByRole('button', { name: '插入多步等式链' });
  await multistepTemplate.scrollIntoViewIfNeeded();
  await multistepTemplate.click();
  await expect(editor).toContainText(String.raw`\begin{aligned}`);
  await expect(page.getByLabel('公式预览').locator('.katex-display')).toBeVisible();
  await expect(page.locator('.composer-wrap')).toHaveAttribute('data-multistep', 'true');
  await expect(
    page.locator(isMobile ? '.composer-note-mobile' : '.composer-note-desktop'),
  ).toContainText('多步演算');
  const requestCountBeforeMultistepEnter = chatRequestCount;
  await editor.press('Control+End');
  await editor.press('Enter');
  expect(chatRequestCount).toBe(requestCountBeforeMultistepEnter);
  await expect(page.locator('.composer-wrap')).toHaveAttribute('data-multistep', 'true');
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      path: `artifacts/acceptance/B03-multistep-composer-${testInfo.project.name}.png`,
    });
  }
  await editor.fill(String.raw`$\frac{2}{3}$`);
  await expect(page.locator('.composer-wrap')).toHaveAttribute('data-multistep', 'false');
  const lastFormulaShortcut = formulaTools.getByRole('button', { name: '插入联立式' });
  await expect(lastFormulaShortcut).toBeAttached();
  await lastFormulaShortcut.scrollIntoViewIfNeeded();
  await expect(lastFormulaShortcut).toBeVisible();
  await formulaTools.locator('.formula-toolbar').evaluate((element) => {
    element.scrollLeft = 0;
  });
  await finishAction.click();
  await expect(page.getByLabel('核对状态：本题结论')).toBeVisible();
  const incorrectCheckpoint = page.getByRole('note', { name: '本题核对说明' }).last();
  await expect(incorrectCheckpoint).toContainText('这次结论还需要修正');
  await expect(incorrectCheckpoint.getByRole('link', { name: /独立检验/ })).toHaveCount(0);
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

  await editor.fill(String.raw`分子分母同乘 $\sqrt{3}$，结果为 $\frac{\sqrt{6}}{3}$。`);
  await finishAction.click();
  const correctCheckpoint = page.getByRole('note', { name: '本题核对说明' }).last();
  await expect(correctCheckpoint).toContainText('这次结论已经核对');
  await expect(correctCheckpoint).toContainText('掌握情况尚未独立验证');
  await expect(correctCheckpoint).toContainText('本题作答结论正确');
  await expect(correctCheckpoint).toContainText('帮助记录已使用：最小提示、直接讲解');
  await expect(correctCheckpoint).toContainText('独立检验尚未进行');
  const independentAssessmentAction = correctCheckpoint.getByRole('link', { name: /独立检验/ });
  await expect(independentAssessmentAction).toBeVisible();
  await expect(independentAssessmentAction).toHaveAttribute(
    'href',
    '/learn/12/check?intent=reassess',
  );
  await expect(page.getByRole('heading', { name: '本题已核对，去独立验证' })).toBeVisible();
  await expect(page.locator('.learning-focus li[data-state="done"]')).toHaveCount(4);
  await expect(page.getByRole('group', { name: '学习帮助' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '核对本题结论' })).toHaveCount(0);
  await expect(editor).toHaveAttribute(
    'data-placeholder',
    '想比较其他解法？可在这里继续补充…',
  );
  expect(chatRequestCount).toBe(4);

  if (isMobile) {
    const currentViewport = page.viewportSize();
    expect(currentViewport).not.toBeNull();
    await page.setViewportSize({ width: currentViewport!.width, height: 640 });
    await expect(independentAssessmentAction).toBeInViewport();
  }

  const composer = await page.locator('.composer-dock').boundingBox();
  expect(composer).not.toBeNull();
  const independentActionBox = await independentAssessmentAction.boundingBox();
  expect(independentActionBox).not.toBeNull();
  expect(independentActionBox!.y + independentActionBox!.height).toBeLessThanOrEqual(composer!.y);
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(
    (page.viewportSize()?.height ?? viewport?.height ?? 900) + 1,
  );
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

test('@B03 a long checked reply can be stopped without losing the student turn', async ({ page }, testInfo) => {
  let releaseRequest: (() => void) | undefined;
  let markRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });

  await page.route('**/api/problems/chat', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ assistanceMode: 'hint' });
    markRequestStarted?.();
    await heldRequest;
    await route.abort('aborted').catch(() => undefined);
  });

  await page.goto('/study');
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await editor.fill('根号2除以根号3怎么化简？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('heading', { name: '题目分析' })).toBeVisible();

  await page.getByRole('button', { name: '提示一点' }).click();
  await requestStarted;
  const stop = page.getByRole('button', { name: '停止本轮回复' });
  await expect(stop).toBeVisible();
  if (testInfo.project.name.startsWith('h5-')) {
    expect((await stop.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  await stop.click();
  releaseRequest?.();
  await expect(page.getByText('已停止本轮回复。你的作答已保留，可以重新回答。')).toBeVisible();
  await expect(page.getByLabel('帮助状态：已请求，尚未发出')).toBeVisible();
  await expect(page.getByLabel('帮助深度：最小提示')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新回答' })).toBeVisible();
  await expect(editor).toBeFocused();
});

test('@B03 unsent learning draft survives refresh', async ({ page }, testInfo) => {
  let chatRequestCount = 0;
  let persistedDraft = '我准备先移项，再配成 $(a-b)^2$。';
  const session = {
    content: '证明 $a^2+b^2\\geq 2ab$。',
    id: '91',
    problemMd: '证明 $a^2+b^2\\geq 2ab$。',
    title: '基本不等式证明',
    topic: '不等式',
    updatedAt: '2026-09-20T00:00:00.000Z',
    version: 1,
  };
  await page.route('**/api/learning/sessions', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ sessions: [session] }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions/91', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        analysis,
        draftMarkdown: persistedDraft,
        messages: [{
          content: analysis.overview,
          id: '1',
          messageType: 'analysis',
          role: 'guide',
        }, {
          content: [
            '要证：$a^2+b^2\\geq 2ab$',
            '依据：平方恒非负',
            '证明：',
            '步骤 1：移项',
            '步骤 2：配成 $(a-b)^2$',
            '结论：原不等式成立',
          ].join('\n'),
          id: '2',
          messageType: 'text',
          role: 'student',
        }],
        record: session,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions/91/draft', async (route) => {
    const body = route.request().postDataJSON() as { markdown: string };
    persistedDraft = body.markdown;
    await route.fulfill({
      body: JSON.stringify({ savedAt: '2026-09-20T00:00:01.000Z' }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/chat', async (route) => {
    chatRequestCount += 1;
    await route.fulfill({ body: '', status: 204 });
  });

  await page.goto('/study?session=91');
  const submittedWork = page.getByRole('article', { name: '你的多步演算，共 6 行' });
  await expect(submittedWork).toBeVisible();
  await expect(submittedWork.getByText('6 行 · 已提交')).toBeVisible();
  await expect(submittedWork.locator('.math-markdown')).toHaveCSS('white-space', 'pre-wrap');
  await expect(submittedWork.locator('.katex')).not.toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) <= 720) {
    const submittedWorkBox = await submittedWork.boundingBox();
    const chatScrollBox = await page.locator('.chat-scroll').boundingBox();
    expect(submittedWorkBox).not.toBeNull();
    expect(chatScrollBox).not.toBeNull();
    expect(submittedWorkBox!.y).toBeGreaterThanOrEqual(chatScrollBox!.y - 1);
  }
  const reviewSubmittedWork = submittedWork.getByRole('button', {
    name: '完整回看多步演算',
  });
  if ((page.viewportSize()?.width ?? 0) <= 720) {
    expect((await reviewSubmittedWork.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await reviewSubmittedWork.click();
  const workReader = page.getByRole('dialog', { name: '回看你的多步演算' });
  await expect(workReader).toBeVisible();
  await expect(workReader).toContainText('步骤 1：移项');
  await expect(workReader).toContainText('结论：原不等式成立');
  await expect(workReader.locator('.katex')).not.toHaveCount(0);
  const closeWorkReader = workReader.getByRole('button', { name: '关闭多步演算回看' });
  await expect(closeWorkReader).toBeFocused();
  const firstQuoteAction = workReader.getByRole('button', { name: '引用第 1 行到草稿' });
  const lastQuoteAction = workReader.getByRole('button', { name: '引用第 6 行到草稿' });
  await page.keyboard.press('Tab');
  await expect(firstQuoteAction).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(closeWorkReader).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(lastQuoteAction).toBeFocused();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      path: `artifacts/acceptance/B03-student-work-reader-${testInfo.project.name}.png`,
    });
  }
  await page.keyboard.press('Escape');
  await expect(workReader).toHaveCount(0);
  await expect(reviewSubmittedWork).toBeFocused();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      path: `artifacts/acceptance/B03-submitted-work-${testInfo.project.name}.png`,
    });
  }
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await expect(editor).toHaveText(persistedDraft);
  await reviewSubmittedWork.click();
  await page.getByRole('dialog', { name: '回看你的多步演算' })
    .getByRole('button', { name: '引用第 1 行到草稿' })
    .click();
  await expect(editor).toContainText(String.raw`我想核对第 1 行：“要证：$a^2+b^2\geq 2ab$”`);
  await expect(page.getByLabel('公式预览').locator('.katex').first()).toBeVisible();
  expect(chatRequestCount).toBe(0);
  await editor.fill(persistedDraft);
  await expect.poll(() => persistedDraft).toBe('我准备先移项，再配成 $(a-b)^2$。');
  await reviewSubmittedWork.click();
  const quoteFourthLine = page.getByRole('dialog', { name: '回看你的多步演算' })
    .getByRole('button', { name: '引用第 4 行到草稿' });
  if ((page.viewportSize()?.width ?? 0) <= 720) {
    expect((await quoteFourthLine.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await quoteFourthLine.click();
  await expect(page.getByRole('dialog', { name: '回看你的多步演算' })).toHaveCount(0);
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('我想核对第 4 行：“步骤 1：移项”');
  await expect(editor).toContainText('我的疑问：');
  expect(chatRequestCount).toBe(0);
  await editor.fill(persistedDraft);
  await expect.poll(() => persistedDraft).toBe('我准备先移项，再配成 $(a-b)^2$。');
  await editor.fill('我准备先移项，得到 $a^2-2ab+b^2$。');
  await expect.poll(() => persistedDraft).toBe('我准备先移项，得到 $a^2-2ab+b^2$。');
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toHaveText('已自动保存');

  await page.reload();
  await expect(page.getByRole('textbox', { name: '输入题目或想法' })).toHaveText(
    '我准备先移项，得到 $a^2-2ab+b^2$。',
  );
});

test('@B03 an unsynced local draft survives refresh and syncs when the network returns', async ({
  page,
}, testInfo) => {
  let allowDraftSync = false;
  let cloudDraft = '云端旧草稿：我准备先移项。';
  const session = {
    content: '证明 $a^2+b^2\\geq 2ab$。',
    id: '92',
    problemMd: '证明 $a^2+b^2\\geq 2ab$。',
    title: '基本不等式证明',
    topic: '不等式',
    updatedAt: '2026-09-20T00:00:00.000Z',
    version: 1,
  };
  await page.route('**/api/learning/sessions', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ sessions: [session] }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions/92', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        analysis,
        draftMarkdown: cloudDraft,
        messages: [{
          content: analysis.overview,
          id: '1',
          messageType: 'analysis',
          role: 'guide',
        }],
        record: session,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions/92/draft', async (route) => {
    if (!allowDraftSync) {
      await route.fulfill({
        body: JSON.stringify({ message: 'network unavailable' }),
        contentType: 'application/json',
        status: 503,
      });
      return;
    }
    const body = route.request().postDataJSON() as { markdown: string };
    cloudDraft = body.markdown;
    await route.fulfill({
      body: JSON.stringify({ savedAt: '2026-09-20T00:00:02.000Z' }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/study?session=92');
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await expect(editor).toHaveText(cloudDraft);
  const localDraft = '断网继续推导：\n步骤 1：$a^2-2ab+b^2$\n步骤 2：$(a-b)^2\\geq 0$';
  await editor.fill(localDraft);
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toContainText(
    '已保存在本机，等待网络恢复',
  );
  const cachedDraft = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('qisi:learning-draft:'));
    if (!key) return null;
    return JSON.parse(localStorage.getItem(key) ?? 'null') as { markdown?: string } | null;
  });
  expect(cachedDraft?.markdown).toContain('断网继续推导');
  expect(cachedDraft?.markdown).toContain(String.raw`$a^2-2ab+b^2$`);
  expect(cachedDraft?.markdown).toContain(String.raw`$(a-b)^2\geq 0$`);
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      path: `artifacts/acceptance/B03-offline-draft-${testInfo.project.name}.png`,
    });
  }

  await page.reload();
  const restoredEditor = page.getByRole('textbox', { name: '输入题目或想法' });
  await expect(restoredEditor).toContainText('断网继续推导');
  expect(await restoredEditor.evaluate((element) => element.textContent)).toBe(cachedDraft?.markdown);
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toContainText(
    '已恢复本机草稿，尚未同步',
  );

  allowDraftSync = true;
  const syncRequest = page.waitForRequest('**/api/learning/sessions/92/draft');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await syncRequest;
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toHaveText('已自动保存');
  expect(cloudDraft).toBe(cachedDraft?.markdown);
  const remainingDraftKeys = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('qisi:learning-draft:')));
  expect(remainingDraftKeys).toEqual([]);
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
