import { chromium, expect } from '@playwright/test';
import { createAppServer } from '../server/app.js';
const env = { NODE_ENV: 'production', APP_ORIGIN: 'http://127.0.0.1', APP_PASSWORD: 'browser-test-password-only' };
const server = createAppServer(env);
let browser;
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  env.APP_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(env.APP_ORIGIN);
  await expect(page.getByLabel('Workspace password')).toBeVisible();
  await page.getByLabel('Workspace password').fill(env.APP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Workspace password')).toBeVisible();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Hosted browser checks passed: production sign-in, protected app, and sign-out.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
}
