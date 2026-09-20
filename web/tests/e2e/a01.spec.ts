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
  await expect(page.getByRole('img', { name: 'f 撇 x 零等于零' })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
