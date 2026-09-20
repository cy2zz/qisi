import { expect, test } from '@playwright/test';

const record = {
  content: String.raw`证明 $a^2+b^2\geq 2ab$。`,
  id: '91',
  problemMd: String.raw`证明 $a^2+b^2\geq 2ab$。`,
  title: '基本不等式证明',
  topic: '不等式',
  updatedAt: '2026-09-20T00:00:00.000Z',
  version: 1,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ user: { id: 'fixture-user', username: '手写验收学生' } }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ sessions: [record] }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions/91', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        analysis: {
          firstQuestion: '移项后能否写成一个平方？',
          keyConditions: ['$a,b$ 为实数'],
          knowledgePoints: ['基本不等式'],
          overview: '这是一道不等式证明题。',
          target: '证明不等式恒成立。',
        },
        messages: [{
          content: '这是一道不等式证明题。',
          id: '1',
          messageType: 'analysis',
          role: 'guide',
        }],
        record,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/learning/sessions/91/draft', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ savedAt: '2026-09-20T00:00:01.000Z' }),
      contentType: 'application/json',
      status: 200,
    });
  });
});

test('@A03 @AT09 @AT11 handwriting is reviewed line by line before teaching', async ({ page }, testInfo) => {
  let postedChat: Record<string, unknown> | undefined;
  await page.route('**/api/media/handwriting?sessionId=91', async (route) => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({
      body: JSON.stringify({
        image: { height: 800, mediaId: '31', url: '/api/media/31', width: 1200 },
        transcript: {
          confirmed: false,
          id: '41',
          lines: [
            { explicitly_confirmed: false, index: 1, text: '$a^2-2ab+b^2$', uncertain: false },
            { explicitly_confirmed: false, index: 2, text: '$=(a-b)^2\\geq0$', uncertain: true },
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
    expect(route.request().postDataJSON()).toMatchObject({
      expected_revision: 1,
      transcript_id: '41',
    });
    await route.fulfill({
      body: JSON.stringify({
        confirmed: true,
        id: '41',
        lines: [
          { explicitly_confirmed: false, index: 1, text: '$a^2-2ab+b^2$', uncertain: false },
          { explicitly_confirmed: true, index: 2, text: '$=(a-b)^2\\geq0$', uncertain: true },
        ],
        media_id: '31',
        revision: 2,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/problems/chat', async (route) => {
    postedChat = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      body: [
        'event: chunk\ndata: {"text":"先说明这一步使用了完全平方。"}',
        'event: done\ndata: {"version":2}',
        '',
      ].join('\n\n'),
      contentType: 'text/event-stream',
      status: 200,
    });
  });

  await page.goto('/study?session=91');
  await expect(page.getByRole('heading', { name: '基本不等式证明' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加手写作答' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加题目图片' })).toHaveCount(0);

  await page.getByLabel('选择手写作答图片').setInputFiles({
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
      'base64',
    ),
    mimeType: 'image/png',
    name: 'proof.png',
  });
  await page.getByRole('button', { name: '识别手写作答' }).click();

  const review = page.getByRole('region', { name: '手写转写核对' });
  await expect(review).toBeVisible();
  await expect(review.getByText('待确认', { exact: true })).toBeVisible();
  await expect(review.getByText('确认表示“转写与原图一致”，不表示数学答案正确。')).toBeVisible();
  const confirm = review.getByRole('button', { name: '确认转写并放入输入框' });
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole('button', { name: '发送' })).toHaveCount(0);

  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 0) <= 720;
  const columns = await review.evaluate(
    (element) => window.getComputedStyle(element).gridTemplateColumns,
  );
  expect(columns.split(' ')).toHaveLength(isMobile ? 1 : 2);
  if (isMobile) {
    for (const button of await review.getByRole('button').all()) {
      const size = await button.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport?.width ?? 1440,
  );
  if (testInfo.project.name === 'pc-1440' || testInfo.project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A03-handwriting-review-${testInfo.project.name}.png`,
    });
  }

  await review.getByRole('button', { name: '确认第 2 行' }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const editor = page.getByRole('textbox', { name: '输入题目或想法' });
  await expect(editor).toContainText('$a^2-2ab+b^2$');
  await expect(page.getByText(isMobile
    ? '手写转写已确认；修改后按普通文字提交。'
    : '手写转写已确认；如果继续修改，将按普通文字提交。')).toBeVisible();
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先说明这一步使用了完全平方。')).toBeVisible();
  expect(postedChat).toMatchObject({
    transcriptId: '41',
    transcriptRevision: 2,
  });
});
