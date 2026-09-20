import { expect, test } from '@playwright/test';

const baseAttempt = {
  answerDraftMarkdown: '',
  assistanceRequested: false,
  finalAnswerMarkdown: null,
  firstSeenEligible: true,
  helpExposed: false,
  helpSessionId: null,
  id: '81',
  lockedPlanMarkdown: null,
  phase: 'check_plan',
  planDraftMarkdown: '',
  planUnanswered: false,
  promptMarkdown: String.raw`求函数 $g(x)=x^2-6x+5$ 的最小值，并说明关键一步。`,
  relation: 'near_transfer',
  result: null,
  sessionId: '12',
  taskId: '61',
  version: 1,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ user: { id: 'fixture-user', username: '独立检验学生' } }),
      contentType: 'application/json',
      status: 200,
    });
  });
});

test('@A04 independent assessment direct URL preserves the original-answer gate', async ({ page }) => {
  await page.route('**/api/assessment/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ body: '{}', contentType: 'application/json', status: 404 });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'ORIGINAL_ANSWER_NOT_READY' }),
      contentType: 'application/json',
      status: 409,
    });
  });
  await page.goto('/learn/12/check');
  await page.getByRole('button', { name: '开始独立检验' }).click();
  await expect(page.getByRole('alert')).toContainText('先回到原题完成核对');
  const returnLink = page.getByRole('link', { name: '返回原题完成核对' });
  await expect(returnLink).toHaveAttribute('href', '/study?session=12');
  const size = await returnLink.boundingBox();
  expect(size?.height).toBeGreaterThanOrEqual(44);
});

test('@A03 @A04 handwriting is confirmed before an assessment plan is locked', async ({ page }, testInfo) => {
  let current = { ...baseAttempt };
  let submittedPlan: Record<string, unknown> | undefined;
  await page.route('**/api/assessment/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/draft')) {
      const body = route.request().postDataJSON() as {
        kind: 'answer' | 'plan';
        markdown: string;
      };
      current = {
        ...current,
        planDraftMarkdown: body.kind === 'plan' ? body.markdown : current.planDraftMarkdown,
        version: current.version + 1,
      };
    } else if (pathname.endsWith('/plan')) {
      submittedPlan = route.request().postDataJSON() as Record<string, unknown>;
      current = {
        ...current,
        lockedPlanMarkdown: String(submittedPlan.planMarkdown),
        phase: 'check_answer' as const,
        planDraftMarkdown: String(submittedPlan.planMarkdown),
        version: current.version + 1,
      };
    }
    await route.fulfill({
      body: JSON.stringify({ attempt: current }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/media/handwriting?sessionId=12', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        image: { height: 800, mediaId: '31', url: '/api/media/31', width: 1200 },
        transcript: {
          confirmed: false,
          id: '41',
          lines: [
            { explicitly_confirmed: false, index: 1, text: '先配方', uncertain: false },
            { explicitly_confirmed: false, index: 2, text: '再利用平方项非负', uncertain: true },
          ],
          media_id: '31',
          revision: 1,
        },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/media/transcripts/41/confirm', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        confirmed: true,
        id: '41',
        lines: [
          { explicitly_confirmed: false, index: 1, text: '先配方', uncertain: false },
          { explicitly_confirmed: true, index: 2, text: '再利用平方项非负', uncertain: true },
        ],
        media_id: '31',
        revision: 2,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/learn/12/check');
  await expect(page.getByRole('button', { name: '添加手写作答' })).toBeVisible();
  await page.getByLabel('选择手写作答图片').setInputFiles({
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
      'base64',
    ),
    mimeType: 'image/png',
    name: 'assessment-plan.png',
  });
  await page.getByRole('button', { name: '识别手写作答' }).click();

  const review = page.getByRole('region', { name: '手写转写核对' });
  await expect(review).toBeVisible();
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toBeHidden();
  await expect(page.getByRole('button', { name: '锁定计划，开始作答' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '我需要帮助' })).toBeDisabled();
  const confirm = review.getByRole('button', { name: '确认转写并放入输入框' });
  await expect(confirm).toBeDisabled();

  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 0) <= 720;
  const columns = await review.evaluate(
    (element) => window.getComputedStyle(element).gridTemplateColumns,
  );
  expect(columns.split(' ')).toHaveLength(isMobile ? 1 : 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A03-assessment-handwriting-${testInfo.project.name}.png`,
    });
  }

  await review.getByRole('button', { name: '确认第 2 行' }).click();
  await confirm.click();
  const lockPlan = page.getByRole('button', { name: '锁定计划，开始作答' });
  await expect(lockPlan).toBeEnabled();
  await lockPlan.click();
  await expect(page.getByRole('heading', { name: '现在独立完成答案' })).toBeVisible();
  expect(submittedPlan).toMatchObject({
    planMarkdown: '先配方\n\n再利用平方项非负',
    transcriptId: '41',
    transcriptRevision: 2,
  });
});

test('@A04 @AT30 locks the first plan and withholds feedback until final submission', async ({ page }, testInfo) => {
  let current: typeof baseAttempt | Record<string, unknown> | null = null;
  const initialViewport = page.viewportSize();
  const isMobile = (initialViewport?.width ?? 0) <= 720;
  await page.route('**/api/assessment/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      await route.fulfill({
        body: JSON.stringify(current ? { attempt: current } : {}),
        contentType: 'application/json',
        status: current ? 200 : 404,
      });
      return;
    }
    if (url.pathname.endsWith('/start')) {
      current = baseAttempt;
    } else if (url.pathname.endsWith('/draft')) {
      const body = route.request().postDataJSON() as {
        kind: 'answer' | 'plan';
        markdown: string;
      };
      const version = Number((current as { version?: number } | null)?.version ?? 0) + 1;
      current = {
        ...current,
        ...(body.kind === 'plan'
          ? { planDraftMarkdown: body.markdown }
          : { answerDraftMarkdown: body.markdown }),
        version,
      };
    } else if (url.pathname.endsWith('/plan')) {
      const body = route.request().postDataJSON() as { planMarkdown: string };
      current = {
        ...current,
        lockedPlanMarkdown: body.planMarkdown,
        phase: 'check_answer',
        planDraftMarkdown: body.planMarkdown,
        version: Number((current as { version?: number } | null)?.version ?? 0) + 1,
      };
    } else if (url.pathname.endsWith('/finish')) {
      const body = route.request().postDataJSON() as { answerMarkdown: string };
      current = {
        ...current,
        finalAnswerMarkdown: body.answerMarkdown,
        phase: 'summary',
        result: {
          evidence: ['首次计划明确使用配方法', '最终答案给出顶点式和最小值'],
          execution: 'correct',
          independentExecution: true,
          independentPlanning: true,
          independentTaskPass: true,
          limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
          planning: 'correct',
          summary: '首次计划与最终执行均有依据。',
        },
        version: 4,
      };
    }
    await route.fulfill({
      body: JSON.stringify({ attempt: current }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/speech/format-math', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        formatted: true,
        markdown: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/learn/12/check');
  await page.getByRole('button', { name: '开始独立检验' }).click();
  await expect(page.getByRole('heading', { name: '先写你准备怎么做' })).toBeVisible();
  await expect(page.locator('.assessment-paper .katex')).toBeVisible();
  await expect(page.getByText('有依据')).toHaveCount(0);
  const planVoice = page.getByRole('group', { name: '语音输入' });
  await expect(planVoice.getByRole('button', { name: '长语音' })).toBeVisible();
  await expect(planVoice.getByRole('button', { name: '实时语音' })).toBeVisible();

  const formulaToolbar = page.getByRole('toolbar', { name: '公式快捷输入' });
  await expect(formulaToolbar.getByRole('button')).toHaveCount(12);
  if (isMobile) {
    const formulaToolbarLayout = await formulaToolbar.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        flexWrap: style.flexWrap,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(formulaToolbarLayout.flexWrap).toBe('wrap');
    expect(formulaToolbarLayout.scrollWidth).toBeLessThanOrEqual(
      formulaToolbarLayout.clientWidth + 1,
    );
  }

  const editor = page.getByRole('textbox', { name: '独立检验作答' });
  if (isMobile) {
    await page.setViewportSize({ width: initialViewport!.width, height: 560 });
    await editor.focus();
    await expect(page.locator('.assessment-paper')).toHaveAttribute('data-collapsed', 'true');
    const expandTask = page.getByRole('button', { name: '展开完整题目' });
    await expect(expandTask).toBeVisible();
    await expect(page.locator('.assessment-paper-compact')).toBeInViewport();
    await expect(editor).toBeInViewport();
    await expect(formulaToolbar).toBeInViewport();
    await expect(page.getByRole('button', { name: '添加手写作答' })).toBeInViewport();
    await expect(page.getByRole('button', { name: '公式转换' })).toBeInViewport();
    const compactPaper = await page.locator('.assessment-paper').boundingBox();
    const expandTaskBox = await expandTask.boundingBox();
    expect(compactPaper).not.toBeNull();
    expect(expandTaskBox).not.toBeNull();
    expect(compactPaper!.height).toBeLessThanOrEqual(150);
    expect(expandTaskBox!.x).toBeGreaterThanOrEqual(compactPaper!.x);
    expect(expandTaskBox!.x + expandTaskBox!.width).toBeLessThanOrEqual(
      compactPaper!.x + compactPaper!.width,
    );
    for (const voiceButton of await planVoice.getByRole('button').all()) {
      const voiceButtonBox = await voiceButton.boundingBox();
      expect(voiceButtonBox?.width).toBeGreaterThanOrEqual(44);
      expect(voiceButtonBox?.height).toBeGreaterThanOrEqual(44);
    }
    if (testInfo.project.name === 'h5-390') {
      await page.screenshot({
        path: 'artifacts/acceptance/A04-writing-keyboard-h5-390.png',
      });
    }
    await page.setViewportSize(initialViewport!);
  }
  await editor.fill('根号2除以根号3等于多少？');
  await page.getByRole('button', { name: '公式转换' }).click();
  await expect(editor).toHaveValue('$\\frac{\\sqrt{2}}{\\sqrt{3}}$ 等于多少？');
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((element) => (element as HTMLTextAreaElement).selectionStart))
    .toBe(await editor.inputValue().then((value) => value.length));
  await editor.fill('');

  await page.getByRole('button', { name: '插入分式' }).click();
  await editor.press('2');
  await page.getByRole('button', { name: '移动到下一个公式输入格' }).click();
  await editor.press('3');
  await expect(editor).toHaveValue('$\\frac{2}{3}$');
  await editor.press('End');
  const systemsButton = page.getByRole('button', { name: '插入联立式' });
  await systemsButton.click();
  await expect(editor).toHaveValue(/\\begin\{cases\}/);

  await editor.fill('先配方，再利用平方项非负。');
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toHaveText('已自动保存');

  await page.reload();
  await expect(page.getByRole('heading', { name: '先写你准备怎么做' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toHaveValue('先配方，再利用平方项非负。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-autosave-${testInfo.project.name}.png`,
    });
  }
  await page.getByRole('button', { name: '锁定计划，开始作答' }).click();
  await expect(page.getByRole('note', { name: '已锁定的首次计划' })).toContainText('先配方');
  await expect(page.getByText('有依据')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '现在独立完成答案' })).toBeVisible();
  await expect(page.getByRole('note', { name: '已锁定的首次计划' })).toContainText('先配方');
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toHaveValue('');
  const answerVoice = page.getByRole('group', { name: '语音输入' });
  await expect(answerVoice.getByRole('button', { name: '长语音' })).toBeVisible();
  await expect(answerVoice.getByRole('button', { name: '实时语音' })).toBeVisible();

  const submitFinalAnswer = page.getByRole('button', { name: '提交最终答案' });
  const skipFinalAnswer = page.getByRole('button', { name: '暂时不作答' });
  await expect(submitFinalAnswer).toBeDisabled();
  await expect(skipFinalAnswer).toBeVisible();
  if (isMobile) {
    const skipFinalAnswerBox = await skipFinalAnswer.boundingBox();
    expect(skipFinalAnswerBox?.height).toBeGreaterThanOrEqual(44);
  }
  await skipFinalAnswer.click();
  const blankAnswerConfirmation = page.getByRole('alertdialog', {
    name: '以空白答案结束本次检验？',
  });
  await expect(blankAnswerConfirmation).toContainText('提交后答案会冻结');
  await expect(blankAnswerConfirmation.getByRole('button', { name: '继续作答' })).toBeFocused();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-empty-answer-confirm-${testInfo.project.name}.png`,
    });
  }
  await page.keyboard.press('Shift+Tab');
  await expect(blankAnswerConfirmation.getByRole('button', { name: '确认未作答并结束' }))
    .toBeFocused();
  await page.keyboard.press('Escape');
  await expect(blankAnswerConfirmation).toBeHidden();
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toBeFocused();

  await page.getByRole('textbox', { name: '独立检验作答' }).fill(
    String.raw`$g(x)=(x-3)^2-4$，所以最小值为 $-4$。`,
  );
  await expect(submitFinalAnswer).toBeEnabled();
  await submitFinalAnswer.click();
  await expect(page.getByRole('heading', { name: '这次新题独立完成' })).toBeVisible();
  await expect(page.getByText('独立证据成立')).toHaveCount(2);
  const submittedEvidence = page.getByRole('region', { name: '你的独立作答证据' });
  await expect(submittedEvidence).toContainText('先配方，再利用平方项非负');
  await expect(submittedEvidence).toContainText('最小值为');
  await expect(submittedEvidence.locator('.katex')).not.toHaveCount(0);
  await expect(page.getByRole('region', { name: '本次核对依据' })).toContainText(
    '最终答案给出顶点式和最小值',
  );
  await expect(page.getByText('掌握百分比')).toHaveCount(0);

  const viewport = page.viewportSize();
  if (isMobile) {
    const workbenchDisplay = await page.locator('.assessment-workbench').evaluate(
      (element) => window.getComputedStyle(element).display,
    );
    expect(workbenchDisplay).toBe('block');
  } else {
    const columns = await page.locator('.assessment-workbench').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(columns.split(' ')).toHaveLength(2);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-check-${testInfo.project.name}.png`,
    });
  }
});

test('@A04 an unsynced assessment plan survives refresh and syncs after reconnect', async ({
  page,
}, testInfo) => {
  let allowDraftSync = false;
  let draftRequests = 0;
  let ownerScopedReads = 0;
  let current = {
    ...baseAttempt,
    planDraftMarkdown: '云端旧计划：先配方。',
  };
  const localPlan = '先配方得到 $g(x)=(x-3)^2-4$，再判断平方项非负。';
  const localAnswer = '$g(x)=(x-3)^2-4$，因为平方项非负，所以最小值为 $-4$。';

  await page.route('**/api/assessment/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET') {
      ownerScopedReads += 1;
      await route.fulfill({
        body: JSON.stringify({ attempt: current }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname.endsWith('/draft')) {
      draftRequests += 1;
      if (!allowDraftSync) {
        await route.fulfill({
          body: JSON.stringify({ message: 'offline' }),
          contentType: 'application/json',
          status: 503,
        });
        return;
      }
      const body = route.request().postDataJSON() as {
        kind: 'answer' | 'plan';
        markdown: string;
      };
      current = {
        ...current,
        ...(body.kind === 'plan'
          ? { planDraftMarkdown: body.markdown }
          : { answerDraftMarkdown: body.markdown }),
        version: current.version + 1,
      };
      await route.fulfill({
        body: JSON.stringify({ attempt: current }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname.endsWith('/plan')) {
      const body = route.request().postDataJSON() as { planMarkdown: string };
      current = {
        ...current,
        lockedPlanMarkdown: body.planMarkdown,
        phase: 'check_answer',
        planDraftMarkdown: body.planMarkdown,
        version: current.version + 1,
      };
      await route.fulfill({
        body: JSON.stringify({ attempt: current }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await route.fulfill({ body: '{}', contentType: 'application/json', status: 500 });
  });

  await page.goto('/learn/12/check');
  const editor = page.getByRole('textbox', { name: '独立检验作答' });
  await expect(editor).toHaveValue('云端旧计划：先配方。');
  await editor.fill(localPlan);
  await expect(page.getByRole('status', { name: '草稿保存状态' }))
    .toHaveText('已保存在本机，等待网络恢复');
  expect(draftRequests).toBe(1);
  expect(current.planDraftMarkdown).toBe('云端旧计划：先配方。');
  expect(await page.evaluate(() => Object.keys(localStorage)
    .some((key) => key.startsWith('qisi:assessment-draft:')))).toBe(true);

  await page.reload();
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toHaveValue(localPlan);
  await expect(page.getByRole('status', { name: '草稿保存状态' }))
    .toHaveText('已恢复本机草稿，尚未同步');
  expect(ownerScopedReads).toBeGreaterThanOrEqual(2);
  expect(draftRequests).toBe(1);
  await expect(page.getByText('有依据')).toHaveCount(0);

  const syncButton = page.getByRole('button', { name: '立即同步' });
  await expect(syncButton).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) <= 720) {
    expect((await syncButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-offline-draft-${testInfo.project.name}.png`,
    });
  }

  allowDraftSync = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toHaveText('已自动保存');
  expect(draftRequests).toBe(2);
  expect(current.planDraftMarkdown).toBe(localPlan);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .some((key) => key.startsWith('qisi:assessment-draft:')))).toBe(false);

  await page.getByRole('button', { name: '锁定计划，开始作答' }).click();
  await expect(page.getByRole('heading', { name: '现在独立完成答案' })).toBeVisible();
  await expect(page.getByRole('note', { name: '已锁定的首次计划' })).toContainText('先配方得到');
  allowDraftSync = false;
  await page.getByRole('textbox', { name: '独立检验作答' }).fill(localAnswer);
  await expect(page.getByRole('status', { name: '草稿保存状态' }))
    .toHaveText('已保存在本机，等待网络恢复');
  expect(draftRequests).toBe(3);

  await page.reload();
  await expect(page.getByRole('heading', { name: '现在独立完成答案' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toHaveValue(localAnswer);
  const lockedPlan = page.getByRole('note', { name: '已锁定的首次计划' });
  await expect(lockedPlan).toContainText('先配方得到');
  await expect(lockedPlan).toContainText('再判断平方项非负');
  await expect(lockedPlan.locator('.katex')).toBeVisible();
  await expect(page.getByRole('status', { name: '草稿保存状态' }))
    .toHaveText('已恢复本机草稿，尚未同步');
  await expect(page.getByText('有依据')).toHaveCount(0);

  allowDraftSync = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toHaveText('已自动保存');
  expect(draftRequests).toBe(4);
  expect(current.answerDraftMarkdown).toBe(localAnswer);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .some((key) => key.startsWith('qisi:assessment-draft:')))).toBe(false);
});

test('@A04 @AT32 requesting help records disqualification before any help is exposed', async ({ page }, testInfo) => {
  let current: Record<string, unknown> = baseAttempt;
  let helpRequests = 0;
  const helpAnalysis = {
    firstQuestion: '先指出你卡住的位置，或在下方选择需要的帮助深度。',
    keyConditions: [],
    knowledgePoints: [],
    overview: '已转入同题教学。检验中的草稿已保留；在你选择帮助方式前，不会自动展示解法。',
    target: '解决这道检验题中的当前卡点',
  };
  await page.route('**/api/assessment/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/help')) {
      helpRequests += 1;
      const body = route.request().postDataJSON() as { currentMarkdown: string };
      current = {
        ...baseAttempt,
        assistanceRequested: true,
        helpExposed: false,
        helpSessionId: '91',
        phase: 'help_requested',
        planDraftMarkdown: body.currentMarkdown,
        version: 2,
      };
    }
    await route.fulfill({
      body: JSON.stringify({ attempt: current }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const record = {
      content: baseAttempt.promptMarkdown,
      id: '91',
      problemMd: baseAttempt.promptMarkdown,
      title: '独立检验题 · 同题教学',
      topic: '独立检验求助',
      version: 1,
    };
    await route.fulfill({
      body: JSON.stringify(pathname.endsWith('/91')
        ? {
            analysis: helpAnalysis,
            messages: [
              {
                content: helpAnalysis.overview,
                id: '1',
                messageType: 'analysis',
                role: 'guide',
              },
              {
                content: '我准备先配方。',
                id: '2',
                messageType: 'assessment_help_request',
                role: 'student',
              },
            ],
            record,
          }
        : { sessions: [record] }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/chat', async (route) => {
    await route.fulfill({
      body: [
        'event: status\ndata: {"message":"正在核对你的这一步"}',
        `event: chunk\ndata: ${JSON.stringify({ text: '先观察二次项系数，再考虑把式子配成平方项。' })}`,
        'event: done\ndata: {"version":2}',
        '',
      ].join('\n\n'),
      contentType: 'text/event-stream',
      status: 200,
    });
  });

  await page.goto('/learn/12/check');
  await page.getByRole('textbox', { name: '独立检验作答' }).fill('我准备先配方。');
  await page.getByRole('button', { name: '我需要帮助' }).click();
  const confirmation = page.getByRole('alertdialog', { name: '结束本次独立检验并求助' });
  await expect(confirmation).toHaveAttribute('aria-modal', 'true');
  await expect(confirmation).toContainText('只记为“带帮助完成”');
  const continueWorking = confirmation.getByRole('button', { name: '继续独立完成' });
  const confirmHelp = confirmation.getByRole('button', { name: '确认求助' });
  await expect(continueWorking).toBeFocused();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-help-confirm-${testInfo.project.name}.png`,
    });
  }
  await page.keyboard.press('Shift+Tab');
  await expect(confirmHelp).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(continueWorking).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toBeFocused();
  expect(helpRequests).toBe(0);

  await page.getByRole('button', { name: '我需要帮助' }).click();
  await expect(continueWorking).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmHelp).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: '当前草稿已保留' })).toBeVisible();
  expect(helpRequests).toBe(1);
  await expect(page.getByText(/实际帮助尚未发出/)).toBeVisible();
  await expect(page.getByRole('link', { name: '进入同题教学' })).toHaveAttribute(
    'href',
    '/study?session=91',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: '当前草稿已保留' })).toBeVisible();
  await page.getByRole('link', { name: '进入同题教学' }).click();
  await expect(page).toHaveURL(/\/study\?session=91$/);
  await expect(page.getByRole('heading', { name: '独立检验题 · 同题教学' })).toBeVisible();
  await expect(page.getByText('我准备先配方。')).toBeVisible();
  await expect(page.getByText(/在你选择帮助方式前，不会自动展示解法/)).toBeVisible();
  await page.getByRole('button', { name: '给一点提示' }).click();
  await expect(page.getByText('先观察二次项系数，再考虑把式子配成平方项。')).toBeVisible();
});

test('@A06 @AT34 starts a distinct reassessment without replacing the previous result', async ({ page }, testInfo) => {
  const completedAttempt = {
    ...baseAttempt,
    finalAnswerMarkdown: String.raw`$g(x)=(x-3)^2-4$。`,
    lockedPlanMarkdown: '先配方。',
    phase: 'summary',
    result: {
      evidence: ['计划与执行均有依据'],
      execution: 'correct',
      independentExecution: true,
      independentPlanning: true,
      independentTaskPass: true,
      limitations: ['任务尚未经过人工审题。'],
      planning: 'correct',
      summary: '首次计划与最终执行均有依据。',
    },
    version: 4,
  };
  const reassessment = {
    ...baseAttempt,
    id: '82',
    promptMarkdown: String.raw`抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？`,
    sessionId: '13',
    taskId: '62',
  };
  await page.route('**/api/assessment/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      body: JSON.stringify({
        attempt: pathname.endsWith('/reassess') ? reassessment : completedAttempt,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/learn/12/check');
  await expect(page.getByRole('heading', { name: '这次新题独立完成' })).toBeVisible();
  await expect(page.getByRole('region', { name: '你的独立作答证据' })).toContainText('先配方');
  await expect(page.getByRole('region', { name: '你的独立作答证据' }).locator('.katex')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看完整学习报告' })).toHaveAttribute(
    'href',
    '/learn/12/report',
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A06-reassessment-summary-${testInfo.project.name}.png`,
    });
  }
  await page.getByRole('button', { name: '再测一道不同的新题' }).click();
  await expect(page.getByRole('heading', { name: '先写你准备怎么做' })).toBeVisible();
  await expect(page.getByText(/顶点纵坐标/)).toBeVisible();
  await expect(page.locator('.assessment-paper .katex')).toBeVisible();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A06-reassessment-new-task-${testInfo.project.name}.png`,
    });
  }
});

test('@A04 @A06 correction success enters a different task without replaying the old summary', async ({ page }, testInfo) => {
  const completedAttempt = {
    ...baseAttempt,
    finalAnswerMarkdown: String.raw`$g(x)=(x-3)^2+4$。`,
    lockedPlanMarkdown: '先配方，再修正常数项。',
    phase: 'summary',
    result: {
      evidence: ['修正前的独立检验执行有误'],
      execution: 'incorrect',
      independentExecution: false,
      independentPlanning: true,
      independentTaskPass: false,
      limitations: ['这份结果只用于保留修正前证据。'],
      planning: 'correct',
      summary: '计划有依据，执行需要修正。',
    },
    version: 4,
  };
  const reassessment = {
    ...baseAttempt,
    id: '82',
    promptMarkdown: String.raw`抛物线 $y=x^2-10x+21$ 的顶点纵坐标是多少？`,
    sessionId: '13',
    taskId: '62',
  };
  let current: typeof completedAttempt | typeof reassessment = completedAttempt;
  let reassessmentRequests = 0;
  await page.route('**/api/assessment/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/reassess')) {
      reassessmentRequests += 1;
      current = reassessment;
    }
    await route.fulfill({
      body: JSON.stringify({ attempt: current }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/learn/12/check?intent=reassess');

  await expect(page.getByRole('heading', { name: '先写你准备怎么做' })).toBeVisible();
  await expect(page.getByText(/顶点纵坐标/)).toBeVisible();
  await expect(page.getByText('计划有依据，执行需要修正。')).toHaveCount(0);
  await expect(page).toHaveURL(/\/learn\/12\/check$/);
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toBeFocused();
  expect(reassessmentRequests).toBe(1);

  await page.reload();
  await expect(page.getByRole('heading', { name: '先写你准备怎么做' })).toBeVisible();
  expect(reassessmentRequests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A06-remediation-direct-reassessment-${testInfo.project.name}.png`,
    });
  }
});

test('@A04 @AT30 routes an execution failure back to correction before reassessment', async ({ page }, testInfo) => {
  let chatRequests = 0;
  const remediationRequests: Array<{ remediationFocus?: string }> = [];
  let persistedRemediationFocus: string | null = null;
  let learningVersion = 4;
  const executionFailure = {
    ...baseAttempt,
    finalAnswerMarkdown: String.raw`$g(x)=(x-3)^2+4$。`,
    lockedPlanMarkdown: '先配方，再利用平方项非负。',
    phase: 'summary',
    result: {
      evidence: ['首次计划明确使用配方法', '最终常数项计算有误'],
      execution: 'incorrect',
      independentExecution: false,
      independentPlanning: true,
      independentTaskPass: false,
      limitations: ['任务尚未经过人工审题。'],
      planning: 'correct',
      summary: '计划有依据，执行需要修正。',
    },
    version: 4,
  };
  await page.route('**/api/assessment/**', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ attempt: executionFailure }),
      contentType: 'application/json',
      status: 200,
    });
  });
  const learningRecord = {
    content: baseAttempt.promptMarkdown,
    id: '12',
    problemMd: baseAttempt.promptMarkdown,
    title: '二次函数最值 · 执行修正',
    topic: '二次函数 · 配方法',
    updatedAt: '2026-09-20T00:00:00.000Z',
    version: 4,
  };
  await page.route('**/api/learning/sessions**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/learning/sessions/12/remediation') {
      const body = route.request().postDataJSON() as { focus: string | null };
      persistedRemediationFocus = body.focus;
      await route.fulfill({
        body: JSON.stringify({ remediationFocus: persistedRemediationFocus }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname === '/api/learning/sessions/12/draft') {
      await route.fulfill({
        body: JSON.stringify({ savedAt: '2026-09-20T00:00:01.000Z' }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (pathname === '/api/learning/sessions/12') {
      await route.fulfill({
        body: JSON.stringify({
          analysis: {
            firstQuestion: '哪一行计算或变形与原计划不一致？',
            keyConditions: ['计划使用配方法', '最终常数项计算有误'],
            knowledgePoints: ['配方法', '代数运算'],
            overview: '方法已经成立，本轮只定位执行中的计算或变形错误。',
            target: '修正执行步骤，不重新更换解题方法。',
          },
          draftMarkdown: '我原来写到这里。',
          remediationFocus: persistedRemediationFocus,
          messages: [{
            content: '方法已经成立，本轮只定位执行中的计算或变形错误。',
            id: '1',
            messageType: 'analysis',
            role: 'guide',
          }],
          record: { ...learningRecord, version: learningVersion },
        }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ sessions: [learningRecord] }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/chat', async (route) => {
    chatRequests += 1;
    remediationRequests.push(route.request().postDataJSON() as { remediationFocus?: string });
    learningVersion += 1;
    await route.fulfill({
      body: [
        'event: chunk\ndata: {"text":"先圈出第一处和原计划不一致的变形，再只重算这一行。"}',
        `event: done\ndata: ${JSON.stringify({ version: learningVersion })}`,
        '',
      ].join('\n\n'),
      contentType: 'text/event-stream',
      status: 200,
    });
  });

  await page.goto('/learn/12/check');
  await expect(page.getByRole('heading', { name: '方法有依据，执行还需要修正' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '方法已经成立，下一步只处理执行卡点' })).toBeVisible();
  const remediation = page.getByRole('link', { name: '回学习页处理执行卡点' });
  await expect(remediation).toHaveAttribute('href', '/study?session=12&remediate=execution');
  await expect(page.getByText('先修正执行，再决定是否换题')).toBeVisible();
  await expect(page.getByRole('button', { name: '换题再测' })).toBeVisible();
  await expect(page.getByRole('button', { name: '再测一道不同的新题' })).toHaveCount(0);

  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 720) {
    for (const action of await page.locator('.assessment-summary-actions > a, .assessment-summary-actions > button').all()) {
      const size = await action.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-check-remediation-${testInfo.project.name}.png`,
    });
  }

  await remediation.click();
  await expect(page).toHaveURL(/\/study\?session=12&remediate=execution$/);
  const handoff = page.getByRole('region', { name: '独立检验修正衔接' });
  await expect(handoff).toContainText('方法已经成立，只定位执行卡点');
  await expect(handoff).toContainText('不会自动发送');
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await expect(editor).not.toBeFocused();
  if ((viewport?.width ?? 0) <= 720) {
    for (const action of await handoff.getByRole('button').all()) {
      const size = await action.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-remediation-handoff-${testInfo.project.name}.png`,
    });
  }
  await handoff.getByRole('button', { name: '写下执行卡点' }).click();
  await expect(editor).toContainText('我原来写到这里。');
  await expect(editor).toContainText('我的方法是对的，但执行中有一步需要修正。我卡在：');
  await expect(editor).toBeFocused();
  await expect(page).toHaveURL(/\/study\?session=12$/);
  expect(chatRequests).toBe(0);
  await expect.poll(() => persistedRemediationFocus).toBe('execution');
  const focus = page.getByRole('status', { name: '本轮修正目标' });
  await expect(focus).toContainText('只处理执行卡点');
  if ((viewport?.width ?? 0) <= 720) {
    for (const action of await focus.getByRole('button').all()) {
      const size = await action.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
      expect(size?.width).toBeGreaterThanOrEqual(120);
    }
  }
  await editor.pressSequentially('展开后符号不确定。');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先圈出第一处和原计划不一致的变形')).toBeVisible();
  expect(remediationRequests[0]?.remediationFocus).toBe('execution');
  await expect(focus).toContainText('只处理执行卡点');
  await expect(page.getByLabel('修正类型：只处理执行卡点')).toBeVisible();

  await editor.fill('我只重算刚才出错的常数项。');
  await page.getByRole('button', { name: '发送' }).click();
  expect(remediationRequests[1]?.remediationFocus).toBe('execution');
  await expect(focus).toContainText('后续作答会继续按这个范围诊断');
  await expect(page.locator('.chat-message-guide .guide-reply-row')).toHaveCount(2);
  await expect(page.getByRole('group', { name: '学习帮助' })).toHaveCount(0);
  await expect(focus.getByRole('button', { name: '核对修正结果' })).toBeVisible();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-remediation-track-${testInfo.project.name}.png`,
    });
  }

  await page.reload();
  await expect(focus).toContainText('只处理执行卡点');
  await focus.getByRole('button', { name: '退出修正模式' }).click();
  await expect(focus).toHaveCount(0);
  await expect.poll(() => persistedRemediationFocus).toBeNull();
  await editor.fill('现在改为普通讨论。');
  await page.getByRole('button', { name: '发送' }).click();
  expect(remediationRequests[2]?.remediationFocus).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A04-remediation-turn-${testInfo.project.name}.png`,
    });
  }
  expect(chatRequests).toBe(3);
});

test('@A05 @AT33 evidence report keeps planning and execution separate', async ({ page }, testInfo) => {
  await page.route('**/api/reports/sessions/12', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        attempts: [
          {
            assistance_requested: false,
            attempt_id: '80',
            execution: 'incorrect',
            help_exposed: false,
            independent_execution: false,
            independent_planning: false,
            independent_task_pass: false,
            invalidated: false,
            limitations: ['第一次检验的方法选择需要修正。'],
            locked_plan_markdown: '先代入几个数试试。',
            plan_unanswered: false,
            final_answer_markdown: '$g(3)=4$。',
            phase: 'summary',
            planning: 'incorrect',
            relation: 'near_transfer',
            task_id: '60',
          },
          {
            assistance_requested: false,
            attempt_id: '81',
            execution: 'incorrect',
            help_exposed: false,
            independent_execution: false,
            independent_planning: true,
            independent_task_pass: false,
            invalidated: false,
            limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
            locked_plan_markdown: '先配方，再利用平方项非负。',
            plan_unanswered: false,
            final_answer_markdown: '$g(x)=(x-3)^2-4$，所以最小值为 $-4$。',
            phase: 'summary',
            planning: 'correct',
            relation: 'near_transfer',
            task_id: '61',
          },
        ],
        delayed_evidence: 'not_evaluated',
        limitations: [
          '报告只反映当前账号和保存期限内的记录，无法识别外部搜题或其他设备上的帮助。',
          '近迁移结果只说明本次任务表现，不等同于长期掌握或提分结论。',
        ],
        observations: [
          '原题已提交核对，但现有证据不足以下数学结论。',
          '首次计划明确使用配方法',
          '最终计算中的常数项有误',
        ],
        original_status: 'unknown',
        session_id: '12',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/learn/12/report');
  await expect(page.getByRole('heading', { name: '这次学习留下了什么证据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '原题完成与帮助' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本次独立规划' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本次独立执行' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '还需要验证什么' })).toBeVisible();
  await expect(page.getByText('独立证据成立')).toHaveCount(1);
  await expect(page.getByText('未形成独立通过证据')).toHaveCount(1);
  const frozenWork = page.getByRole('region', { name: '本次冻结的独立作答' });
  await expect(frozenWork.getByRole('heading', { name: '首次计划' })).toBeVisible();
  await expect(frozenWork).toContainText('先配方，再利用平方项非负');
  await expect(frozenWork.getByRole('heading', { name: '最终答案' })).toBeVisible();
  await expect(frozenWork).toContainText('所以最小值为');
  await expect(frozenWork.locator('.katex')).not.toHaveCount(0);
  await expect(page.getByText('整题不记为独立通过；计划和执行继续分开保留。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '方法不用推倒重来，只修执行卡点' })).toBeVisible();
  const attemptSwitch = page.getByRole('group', { name: '切换独立检验记录' });
  const firstAttempt = attemptSwitch.getByRole('button', { name: /查看第 1 次独立检验/ });
  const latestAttempt = attemptSwitch.getByRole('button', { name: /查看第 2 次独立检验/ });
  await expect(latestAttempt).toHaveAttribute('aria-pressed', 'true');
  await expect(firstAttempt).toHaveAttribute('aria-pressed', 'false');
  await firstAttempt.click();
  await expect(firstAttempt).toHaveAttribute('aria-pressed', 'true');
  await expect(frozenWork).toContainText('先代入几个数试试');
  await expect(frozenWork).not.toContainText('先配方，再利用平方项非负');
  await expect(page.getByText('正在查看第 1 次独立检验')).toBeVisible();
  await expect(page.getByRole('heading', { name: '方法不用推倒重来，只修执行卡点' })).toBeVisible();
  await expect(page.getByText('下一步始终依据最近一次检验，切换记录只用于对照。')).toBeVisible();
  await latestAttempt.focus();
  await page.keyboard.press('Enter');
  await expect(latestAttempt).toHaveAttribute('aria-pressed', 'true');
  await expect(frozenWork).toContainText('先配方，再利用平方项非负');
  await expect(page.getByRole('link', { name: '回学习页处理执行卡点' })).toHaveAttribute(
    'href',
    '/study?session=12&remediate=execution',
  );
  await expect(page.getByText(/\d+%/)).toHaveCount(0);

  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 720) {
    await expect(page.locator('.report-evidence-grid')).toHaveCSS('display', 'block');
    const attemptSwitchBox = await attemptSwitch.boundingBox();
    const firstAttemptBox = await firstAttempt.boundingBox();
    const latestAttemptBox = await latestAttempt.boundingBox();
    expect(firstAttemptBox?.height).toBeGreaterThanOrEqual(44);
    expect(latestAttemptBox?.height).toBeGreaterThanOrEqual(44);
    expect(await attemptSwitch.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(firstAttemptBox?.x).toBeGreaterThanOrEqual(attemptSwitchBox?.x ?? 0);
    expect((firstAttemptBox?.x ?? 0) + (firstAttemptBox?.width ?? 0)).toBeLessThanOrEqual(
      (attemptSwitchBox?.x ?? 0) + (attemptSwitchBox?.width ?? 0),
    );
    expect(latestAttemptBox?.y).toBeGreaterThan(firstAttemptBox?.y ?? 0);
    for (const link of await page.locator('.report-actions a').all()) {
      const size = await link.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
  } else {
    const columns = await page.locator('.report-evidence-grid').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(columns.split(' ')).toHaveLength(2);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A05-report-${testInfo.project.name}.png`,
    });
  }
});

test('@A05 @A09 @AT56 report loading failure is recoverable by keyboard', async ({ page }, testInfo) => {
  let requestCount = 0;
  let allowSuccess = false;
  let releaseRetry: (() => void) | undefined;
  const retryGate = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  await page.route('**/api/reports/sessions/12', async (route) => {
    requestCount += 1;
    if (!allowSuccess) {
      await route.fulfill({
        body: JSON.stringify({ code: 'TEMPORARY_FAILURE' }),
        contentType: 'application/json',
        status: 503,
      });
      return;
    }
    await retryGate;
    await route.fulfill({
      body: JSON.stringify({
        attempts: [],
        delayed_evidence: 'not_evaluated',
        limitations: ['近迁移结果只说明本次任务表现，不等同于长期掌握。'],
        observations: ['原题仍在进行中。'],
        original_status: 'in_progress',
        session_id: '12',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/learn/12/report');
  const retry = page.getByRole('button', { name: '重新读取学习报告' });
  await expect(page.getByRole('heading', { name: '学习报告还没加载出来' })).toBeVisible();
  await expect(retry).toBeFocused();
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 720) {
    const size = await retry.boundingBox();
    expect(size?.height).toBeGreaterThanOrEqual(44);
  }
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A05-report-recovery-${testInfo.project.name}.png`,
    });
  }

  allowSuccess = true;
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('正在重新读取学习报告');
  await expect(page.getByRole('button', { name: '正在重新读取学习报告' })).toBeDisabled();
  releaseRetry?.();

  const reportTitle = page.getByRole('heading', { name: '这次学习留下了什么证据' });
  await expect(reportTitle).toBeVisible();
  await expect(reportTitle).toBeFocused();
  expect(requestCount).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
});
