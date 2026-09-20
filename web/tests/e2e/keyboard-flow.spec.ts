import { expect, type Locator, type Page, test } from '@playwright/test';

const analysis = {
  firstQuestion: String.raw`要消去分母中的 $\sqrt{3}$，分子分母应同时乘什么？`,
  keyConditions: [String.raw`原式为 $\frac{\sqrt{2}}{\sqrt{3}}$`],
  knowledgePoints: ['二次根式', '分母有理化'],
  overview: '这是一道根式化简题，先确定分母有理化所需的因式。',
  target: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$，使分母不含根号。`,
};

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
  promptMarkdown: String.raw`化简 $\frac{3}{\sqrt{6}}$，并写出分母有理化的关键步骤。`,
  relation: 'near_transfer',
  result: null,
  sessionId: '12',
  taskId: '61',
  version: 1,
};

async function tabTo(page: Page, target: Locator, maximumTabs = 160) {
  await expect(target).toBeVisible();
  for (let index = 0; index < maximumTabs; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute('aria-label') ?? await target.textContent()}`);
}

test('@A09 @AT56 keyboard and narrow-screen users can finish the learning evidence flow without losing a failed draft', async ({
  page,
}, testInfo) => {
  let chatRequestCount = 0;
  let currentAttempt: Record<string, unknown> | null = null;
  let draftSaveAttempts = 0;
  let releaseStart: (() => void) | undefined;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ user: { id: 'fixture-user', username: '键盘验收' } }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      body: JSON.stringify(pathname.endsWith('/draft') ? { savedAt: '2026-09-20T00:00:00.000Z' } : { sessions: [] }),
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
            questions: [{
              id: '801',
              imageHeight: null,
              imageWidth: null,
              number: 1,
              questionCode: '2024北京#01',
              questionImageUrl: null,
              statementMarkdown: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$。`,
              status: 'ready',
            }],
          }
        : { papers: [paper], total: 1 };
    await route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status: 200 });
  });
  await page.route('**/api/problems/analyze', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        analysis,
        preparation: { cached: true, status: 'ready' },
        problemMd: String.raw`化简 $\frac{\sqrt{2}}{\sqrt{3}}$。`,
        session: { id: '12', title: '根式分母有理化', version: 1 },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/chat', async (route) => {
    chatRequestCount += 1;
    const body = route.request().postDataJSON() as { assistanceMode?: string };
    const finishing = body.assistanceMode === 'finish_problem';
    const reply = finishing
      ? String.raw`这次结论有依据：$\frac{\sqrt{2}}{\sqrt{3}}=\frac{\sqrt{6}}{3}$。`
      : '你已经指出关键操作。现在把分子、分母分别化简。';
    await route.fulfill({
      body: [
        'event: status\ndata: {"message":"正在核对你的这一步"}',
        `event: chunk\ndata: ${JSON.stringify({ text: reply })}`,
        `event: done\ndata: ${JSON.stringify({ currentVerdict: finishing ? 'correct' : undefined, version: chatRequestCount + 1 })}`,
        '',
      ].join('\n\n'),
      contentType: 'text/event-stream',
      status: 200,
    });
  });
  await page.route('**/api/assessment/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        body: JSON.stringify(currentAttempt ? { attempt: currentAttempt } : {}),
        contentType: 'application/json',
        status: currentAttempt ? 200 : 404,
      });
      return;
    }
    if (pathname.endsWith('/start')) {
      await startGate;
      currentAttempt = { ...baseAttempt };
    } else if (pathname.endsWith('/draft')) {
      draftSaveAttempts += 1;
      if (draftSaveAttempts === 1) {
        await route.fulfill({
          body: JSON.stringify({ code: 'TEMPORARY_FAILURE' }),
          contentType: 'application/json',
          status: 503,
        });
        return;
      }
      const body = route.request().postDataJSON() as { kind: 'answer' | 'plan'; markdown: string };
      currentAttempt = {
        ...currentAttempt,
        ...(body.kind === 'plan'
          ? { planDraftMarkdown: body.markdown }
          : { answerDraftMarkdown: body.markdown }),
        version: Number(currentAttempt?.version ?? 0) + 1,
      };
    } else if (pathname.endsWith('/plan')) {
      const body = route.request().postDataJSON() as { planMarkdown: string };
      currentAttempt = {
        ...currentAttempt,
        lockedPlanMarkdown: body.planMarkdown,
        phase: 'check_answer',
        planDraftMarkdown: body.planMarkdown,
        version: Number(currentAttempt?.version ?? 0) + 1,
      };
    } else if (pathname.endsWith('/finish')) {
      const body = route.request().postDataJSON() as { answerMarkdown: string };
      currentAttempt = {
        ...currentAttempt,
        finalAnswerMarkdown: body.answerMarkdown,
        phase: 'summary',
        result: {
          evidence: ['首次计划包含分母有理化', '最终答案完成等价化简'],
          execution: 'correct',
          independentExecution: true,
          independentPlanning: true,
          independentTaskPass: true,
          limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
          planning: 'correct',
          summary: '首次计划与最终执行均有依据。',
        },
        version: Number(currentAttempt?.version ?? 0) + 1,
      };
    }
    await route.fulfill({
      body: JSON.stringify({ attempt: currentAttempt }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/reports/sessions/12', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        attempts: [{
          assistance_requested: false,
          attempt_id: '81',
          execution: 'correct',
          help_exposed: false,
          independent_execution: true,
          independent_planning: true,
          independent_task_pass: true,
          invalidated: false,
          limitations: ['任务由模型生成并独立复核，尚未经过人工审题。'],
          phase: 'summary',
          planning: 'correct',
          relation: 'near_transfer',
          task_id: '61',
        }],
        delayed_evidence: 'not_evaluated',
        limitations: ['报告只反映当前账号和保存期限内的记录。'],
        observations: ['原题作答有依据。', '首次计划包含分母有理化。', '最终答案完成等价化简。'],
        original_status: 'completed_without_recorded_help',
        session_id: '12',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/study');
  const openBank = page.getByRole('button', { name: '去题库选择' });
  await tabTo(page, openBank);
  await page.keyboard.press('Enter');
  const chooseQuestion = page.getByRole('button', { name: '选择第 1 题' });
  await tabTo(page, chooseQuestion);
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: '题目分析' })).toBeVisible();
  const composer = page.getByRole('textbox', { name: '输入题目或想法' });
  await expect(composer).toBeFocused();
  await page.keyboard.insertText(String.raw`分子分母同乘 $\sqrt{3}$。`);
  await page.keyboard.press('Enter');
  await expect(page.getByText('你已经指出关键操作。现在把分子、分母分别化简。')).toBeVisible();
  await expect(composer).toBeFocused();

  const finishOriginal = page.getByRole('button', { name: '核对本题结论' });
  await tabTo(page, finishOriginal);
  await page.keyboard.press('Enter');
  await expect(composer).toBeFocused();
  await page.keyboard.insertText(String.raw`结果为 $\frac{\sqrt{6}}{3}$。`);
  await page.keyboard.press('Enter');
  const independentCheck = page.getByRole('link', { name: /换一道题独立检验/ });
  await expect(independentCheck).toBeVisible();
  await tabTo(page, independentCheck);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/learn\/12\/check\?intent=reassess$/);
  await expect(page.getByText('正在准备一道不同的新题…', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '独立检验作答' })).toHaveCount(0);
  releaseStart?.();

  const assessmentEditor = page.getByRole('textbox', { name: '独立检验作答' });
  await expect(assessmentEditor).toBeFocused();
  await page.keyboard.insertText('先将分子分母同乘根式，再约分。');
  await expect(page.getByRole('status', { name: '草稿保存状态' }))
    .toHaveText('已保存在本机，等待网络恢复');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(assessmentEditor).toHaveValue('先将分子分母同乘根式，再约分。');

  const retrySave = page.getByRole('button', { name: '立即同步' });
  await tabTo(page, retrySave);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: '草稿保存状态' })).toHaveText('已自动保存');

  const lockPlan = page.getByRole('button', { name: '锁定计划，开始作答' });
  await tabTo(page, lockPlan);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '现在独立完成答案' })).toBeVisible();
  await expect(assessmentEditor).toBeFocused();
  await page.keyboard.insertText(String.raw`$\frac{3}{\sqrt{6}}=\frac{\sqrt{6}}{2}$。`);

  const submitAnswer = page.getByRole('button', { name: '提交最终答案' });
  await tabTo(page, submitAnswer);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '这次新题独立完成' })).toBeVisible();

  const reportLink = page.getByRole('link', { name: '查看完整学习报告' });
  await tabTo(page, reportLink);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '这次学习留下了什么证据' })).toBeVisible();
  await expect(page.getByText('独立证据成立')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '本次近迁移成立，下一步看能否稳定保持' })).toBeVisible();
  await expect(page.getByRole('link', { name: '再测一道不同新题' })).toHaveAttribute(
    'href',
    '/learn/12/check?intent=reassess',
  );
  await expect(page.getByText(/\d+%/)).toHaveCount(0);
  await expect.poll(async () => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A09-keyboard-report-${testInfo.project.name}.png`,
    });
  }
});
