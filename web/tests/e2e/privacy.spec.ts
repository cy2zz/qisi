import { expect, test } from '@playwright/test';

const historyFixtureEntry = {
  assessment: {
    assistance_requested: false,
    execution: 'incorrect',
    help_exposed: false,
    independent_task_pass: false,
    limitations: ['最终执行仍需要修正。'],
    phase: 'summary',
    planning: 'correct',
    relation: 'near_transfer',
  },
  help: { exposed: true, modes: ['hint'], requested: true },
  latest_student_work_markdown: String.raw`我先把 $x^2-4x$ 配成完全平方。`,
  original_status: 'completed_with_help',
  session_id: '12',
  title: '二次函数最值',
  topic: '二次函数',
  updated_at: '2026-09-19T10:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ user: { id: 'fixture-user', username: '历史验收学生' } }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/history', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        entries: [historyFixtureEntry, {
          ...historyFixtureEntry,
          session_id: '11',
          title: '较早的函数练习',
          topic: '函数',
          updated_at: '2026-09-18T08:00:00.000Z',
        }],
        retention: {
          delayed_evidence: 'not_evaluated',
          history_incomplete: false,
          session_days: 7,
        },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/history/sessions/12', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().postDataJSON()).toEqual({ confirm: true });
    await route.fulfill({
      body: JSON.stringify({ deleted: true, deletedSessionCount: 1 }),
      contentType: 'application/json',
      status: 200,
    });
  });
});

test('@A06 @AT47 deletion requires confirmation and removes the private history entry', async ({ page }, testInfo) => {
  await page.goto('/history');

  const deleteTrigger = page.getByRole('button', { name: '删除记录' });
  await deleteTrigger.click();
  const confirmation = page.getByRole('alertdialog', { name: '删除这条学习记录？' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('公开题库不受影响');
  await expect(confirmation.getByRole('button', { name: '保留记录' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  await deleteTrigger.click();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A06-delete-confirm-${testInfo.project.name}.png`,
    });
  }

  await confirmation.getByRole('button', { name: '保留记录' }).click();
  await expect(confirmation).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  await expect(page.getByRole('heading', { name: '二次函数最值' })).toBeVisible();

  await deleteTrigger.click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('heading', { name: '二次函数最值' })).toBeHidden();
});

test('@A06 @AT38 history keeps thought, help, and later evidence together', async ({ page }, testInfo) => {
  await page.goto('/history');

  const latestDisclosure = page.locator('.history-entry-disclosure').first();
  await expect(page.getByRole('heading', { name: '学习证据时间线' })).toBeVisible();
  await expect(latestDisclosure.getByRole('heading', { name: '二次函数最值' })).toBeVisible();
  await expect(latestDisclosure.getByText('我当时怎么想')).toBeVisible();
  await expect(latestDisclosure.getByText('看过：一点提示')).toBeVisible();
  await expect(latestDisclosure.locator('summary')).toContainText('计划有依据，执行需要修正');
  await expect(latestDisclosure.locator('.katex')).toBeVisible();
  await expect(latestDisclosure.getByRole('link', { name: '查看证据报告' })).toHaveAttribute('href', '/learn/12/report');
  await expect(latestDisclosure.getByRole('link', { name: '回学习页处理执行卡点' })).toHaveAttribute(
    'href',
    '/study?session=12&remediate=execution',
  );

  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 0) <= 760;
  if (isMobile) {
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeHidden();
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeVisible();
    await expect(page.getByRole('link', { name: '学习历史' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '关闭导航', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '学习导航' })).toBeHidden();
  } else {
    const track = await latestDisclosure.locator('.history-evidence-track').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(track.split(' ')).toHaveLength(3);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );

  const checkLink = latestDisclosure.getByRole('link', { name: '回学习页处理执行卡点' });
  await checkLink.scrollIntoViewIfNeeded();
  await expect(checkLink).toBeVisible();
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: !isMobile,
      path: `artifacts/acceptance/A06-history-${testInfo.project.name}.png`,
    });
  }
});

test('@A06 older history stays scannable and expands without losing evidence', async ({ page }) => {
  await page.goto('/history');

  const disclosures = page.locator('.history-entry-disclosure');
  await expect(disclosures).toHaveCount(2);
  await expect(disclosures.nth(0)).toHaveAttribute('open', '');
  await expect(disclosures.nth(1)).not.toHaveAttribute('open', '');

  const olderSummary = disclosures.nth(1).locator('summary');
  await expect(olderSummary).toContainText('较早的函数练习');
  await expect(olderSummary).toContainText('计划有依据，执行需要修正');
  await expect(olderSummary).toContainText('方法不用推倒重来，只修执行卡点');
  await expect(olderSummary).toContainText('展开详情');
  await expect(disclosures.nth(1).getByText('我当时怎么想')).toBeHidden();

  const summaryBox = await olderSummary.boundingBox();
  expect(summaryBox?.height).toBeGreaterThanOrEqual(44);
  await olderSummary.press('Enter');
  await expect(disclosures.nth(1)).toHaveAttribute('open', '');
  await expect(olderSummary).toContainText('收起详情');
  await expect(disclosures.nth(1).getByText('我当时怎么想')).toBeVisible();
  await expect(disclosures.nth(1).getByText('看过：一点提示')).toBeVisible();
  await expect(disclosures.nth(1).getByRole('link', { name: '查看证据报告' })).toHaveAttribute(
    'href',
    '/learn/11/report',
  );

  const viewport = page.viewportSize();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
});

test('@A06 history does not bypass original-answer correction', async ({ page }) => {
  await page.unroute('**/api/history');
  await page.route('**/api/history', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        entries: [{
          assessment: null,
          help: { exposed: false, modes: [], requested: false },
          latest_student_work_markdown: String.raw`我写成了 $\frac{2}{3}$，还没有核对。`,
          original_status: 'incomplete',
          session_id: '13',
          title: '仍需修正的根式题',
          topic: '二次根式',
          updated_at: '2026-09-19T11:00:00.000Z',
        }],
        retention: {
          delayed_evidence: 'not_evaluated',
          history_incomplete: false,
          session_days: 7,
        },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/history');
  await expect(page.getByText('原题结论仍需要修正')).toBeVisible();
  await expect(page.getByRole('link', { name: /独立检验/ })).toHaveCount(0);
  const correctionLink = page.getByRole('link', { name: '回原题修正结论' });
  await expect(correctionLink).toHaveAttribute('href', '/study?session=13');
  await expect(correctionLink).toBeVisible();
  const size = await correctionLink.boundingBox();
  expect(size?.height).toBeGreaterThanOrEqual(44);
});

test('@A06 history distinguishes requested help from exposed help', async ({ page }) => {
  await page.unroute('**/api/history');
  await page.route('**/api/history', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        entries: [{
          ...historyFixtureEntry,
          assessment: {
            ...historyFixtureEntry.assessment,
            assistance_requested: true,
            execution: 'correct',
            help_exposed: false,
            planning: 'correct',
          },
          help: { exposed: false, modes: [], requested: false },
          session_id: '14',
          title: '请求帮助但未展示的检验',
        }],
        retention: {
          delayed_evidence: 'not_evaluated',
          history_incomplete: false,
          session_days: 7,
        },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/history');
  const disclosure = page.locator('.history-entry-disclosure').first();
  await expect(disclosure.locator('summary')).toContainText('本次检验请求过帮助，尚未记录实际展示');
  await expect(disclosure.locator('summary')).not.toContainText('本次检验使用过帮助');
  await expect(disclosure.getByRole('link', { name: '查看证据边界' })).toHaveAttribute(
    'href',
    '/study?session=14&remediate=evidence',
  );
});
