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

test('@A04 @AT30 locks the first plan and withholds feedback until final submission', async ({ page }, testInfo) => {
  let current: typeof baseAttempt | Record<string, unknown> | null = null;
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
    } else if (url.pathname.endsWith('/plan')) {
      const body = route.request().postDataJSON() as { planMarkdown: string };
      current = {
        ...baseAttempt,
        lockedPlanMarkdown: body.planMarkdown,
        phase: 'check_answer',
        planDraftMarkdown: body.planMarkdown,
        version: 2,
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

  await page.goto('/learn/12/check');
  await page.getByRole('button', { name: '开始独立检验' }).click();
  await expect(page.getByRole('heading', { name: '先写你准备怎么做' })).toBeVisible();
  await expect(page.locator('.assessment-paper .katex')).toBeVisible();
  await expect(page.getByText('有依据')).toHaveCount(0);

  const editor = page.getByRole('textbox', { name: '独立检验作答' });
  await editor.fill('先配方，再利用平方项非负。');
  await page.getByRole('button', { name: '锁定计划，开始作答' }).click();
  await expect(page.getByRole('note', { name: '已锁定的首次计划' })).toContainText('先配方');
  await expect(page.getByText('有依据')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '现在独立完成答案' })).toBeVisible();
  await expect(page.getByRole('note', { name: '已锁定的首次计划' })).toContainText('先配方');
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toHaveValue('');

  await page.getByRole('textbox', { name: '独立检验作答' }).fill(
    String.raw`$g(x)=(x-3)^2-4$，所以最小值为 $-4$。`,
  );
  await page.getByRole('button', { name: '提交最终答案' }).click();
  await expect(page.getByRole('heading', { name: '这次新题独立完成' })).toBeVisible();
  await expect(page.getByText('独立证据成立')).toHaveCount(2);
  await expect(page.getByText('掌握百分比')).toHaveCount(0);

  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 0) <= 720;
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

test('@A04 @AT32 requesting help records disqualification before any help is exposed', async ({ page }) => {
  let current: Record<string, unknown> = baseAttempt;
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
  await expect(confirmation).toContainText('只记为“带帮助完成”');
  await confirmation.getByRole('button', { name: '确认求助' }).click();

  await expect(page.getByRole('heading', { name: '当前草稿已保留' })).toBeVisible();
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

test('@A05 @AT33 evidence report keeps planning and execution separate', async ({ page }, testInfo) => {
  await page.route('**/api/reports/sessions/12', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        attempts: [{
          assistance_requested: false,
          attempt_id: '81',
          execution: 'incorrect',
          help_exposed: false,
          independent_execution: false,
          independent_planning: true,
          independent_task_pass: false,
          invalidated: false,
          limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
          planning: 'correct',
          relation: 'near_transfer',
          task_id: '61',
        }],
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
  await expect(page.getByText('整题不记为独立通过；计划和执行继续分开保留。')).toBeVisible();
  await expect(page.getByText(/\d+%/)).toHaveCount(0);

  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 720) {
    await expect(page.locator('.report-evidence-grid')).toHaveCSS('display', 'block');
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
