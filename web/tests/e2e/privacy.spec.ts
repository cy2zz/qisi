import { expect, test } from '@playwright/test';

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
        entries: [{
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

  await page.getByRole('button', { name: '删除记录' }).click();
  const confirmation = page.getByRole('alertdialog', { name: '删除这条学习记录？' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('公开题库不受影响');
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A06-delete-confirm-${testInfo.project.name}.png`,
    });
  }

  await confirmation.getByRole('button', { name: '保留记录' }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole('heading', { name: '二次函数最值' })).toBeVisible();

  await page.getByRole('button', { name: '删除记录' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('heading', { name: '二次函数最值' })).toBeHidden();
});

test('@A06 @AT38 history keeps thought, help, and later evidence together', async ({ page }, testInfo) => {
  await page.goto('/history');

  await expect(page.getByRole('heading', { name: '学习证据时间线' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '二次函数最值' })).toBeVisible();
  await expect(page.getByText('我当时怎么想')).toBeVisible();
  await expect(page.getByText('看过：一点提示')).toBeVisible();
  await expect(page.getByText('计划有依据，执行需要修正')).toBeVisible();
  await expect(page.locator('.history-entry .katex')).toBeVisible();
  await expect(page.getByRole('link', { name: '继续原题' })).toHaveAttribute('href', '/study?session=12');
  await expect(page.getByRole('link', { name: '查看证据报告' })).toHaveAttribute('href', '/learn/12/report');

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
    const track = await page.locator('.history-evidence-track').evaluate(
      (element) => window.getComputedStyle(element).gridTemplateColumns,
    );
    expect(track.split(' ')).toHaveLength(3);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );

  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A06-history-${testInfo.project.name}.png`,
    });
  }
  const checkLink = page.getByRole('link', { name: '继续独立检验' });
  await checkLink.scrollIntoViewIfNeeded();
  await expect(checkLink).toBeVisible();
});
