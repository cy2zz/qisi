import 'reflect-metadata';
import { config as loadEnvironmentFile } from 'dotenv';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  if (!environment.AI_API_KEY) throw new Error('AI_API_KEY is required for the live tutor UI verifier');

  const database = createDatabase(environment);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } });
  const username = `at15_live_${Date.now()}`;
  let userId: string | undefined;

  try {
    const loginResponse = await context.request.post('http://localhost:5173/api/auth/login', {
      data: { username },
      headers: { Origin: environment.WEB_ORIGIN },
    });
    if (!loginResponse.ok()) throw new Error(`AT15 live login failed: HTTP ${loginResponse.status()}`);
    const login = await loginResponse.json() as { user: { id: string } };
    userId = String(login.user.id);

    const page = await context.newPage();
    await page.goto('http://localhost:5173/study');
    const composer = page.getByRole('textbox', { name: '输入题目或想法' });
    await composer.fill('化简 $\\frac{\\sqrt{2}}{\\sqrt{3}}$。');
    await page.getByRole('button', { name: '发送' }).click();
    await page.getByRole('heading', { name: '题目分析' }).waitFor({ timeout: 60_000 });
    await page.getByRole('group', { name: '快捷回应' }).waitFor();

    if (await page.locator('.chat-message-guide').count() !== 1) {
      throw new Error('AT15 live session exposed an unexpected guide turn before help');
    }
    if (await page.locator('.chat-message-mode').count() !== 0) {
      throw new Error('AT15 live session recorded help depth before help was requested');
    }
    if (!await composer.evaluate((element) => element === document.activeElement)) {
      throw new Error('AT15 live session did not return focus to autonomous input');
    }
    const visibleText = await page.locator('main').innerText();
    const problemTitle = await page.locator('#problem-sheet-title').innerText();
    if (/fracsqrt/i.test(problemTitle) || /fracsqrt/i.test(visibleText)) {
      throw new Error(`AT15 live session kept a raw LaTeX-derived title: ${problemTitle}`);
    }
    if (visibleText.includes('最终答案') || visibleText.includes('完整解法')) {
      throw new Error('AT15 live session exposed a complete-solution marker before help');
    }

    const screenshotPath = resolve(
      import.meta.dirname,
      '..',
      '..',
      'artifacts',
      'acceptance',
      'B03-AT15-live-pc-1440.png',
    );
    await page.screenshot({ fullPage: true, path: screenshotPath });
    console.info(
      `AT15 live UI passed: guideMessages=1, helpLabels=0, autonomousInputFocused=true, title=${JSON.stringify(problemTitle)}, screenshot=${screenshotPath}`,
    );
  } finally {
    await context.close();
    await browser.close();
    if (userId) await database.deleteFrom('users').where('id', '=', userId).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'AT15 live UI verification failed');
  process.exitCode = 1;
});
