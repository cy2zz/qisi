import { expect, test } from '@playwright/test';

test('@A01 login shell keeps the mathematics context usable', async ({ page }) => {
  await page.goto('/');

  const username = page.getByLabel('用户名');
  await expect(username).toBeVisible();
  await expect(username).toBeFocused();
  await expect(username).toHaveAttribute('data-slot', 'input');
  await expect(page.getByRole('button', { name: '进入学习空间' })).toHaveAttribute(
    'data-slot',
    'button',
  );

  const classroom = page.getByRole('region', { name: '互动数学课堂' });
  await expect(classroom).toBeVisible();
  await expect(classroom.getByRole('img', {
    name: '一对一老师在黑板辅导学生完成二次函数挑战',
  })).toBeVisible();
  await expect(classroom.getByRole('heading', { name: '一对一数学作战室' })).toBeVisible();
  await expect(classroom.locator('.classroom-3d-canvas')).toBeVisible();

  await username.fill('小林');
  await expect(classroom).toContainText('辅导对象：小林');

  await classroom.getByRole('button', { name: '我卡在这里' }).click();
  await expect(classroom.getByRole('status')).toContainText('先看为什么要配方');
  await expect(classroom.getByRole('button', { name: '我卡在这里' }))
    .toHaveAttribute('aria-pressed', 'true');

  const classroomButtons = await classroom.getByRole('button').all();
  if (test.info().project.name.startsWith('h5-')) {
    for (const button of classroomButtons) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }

  await classroom.getByRole('button', { name: '暂停课堂演示' }).click();
  await expect(classroom.getByRole('button', { name: '继续课堂演示' })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  if (test.info().project.name === 'pc-1440' || test.info().project.name === 'h5-390') {
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/A01-login-classroom-${test.info().project.name}.png`,
    });
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(classroom.getByRole('button', { name: '已减少动效' })).toBeDisabled();
});
