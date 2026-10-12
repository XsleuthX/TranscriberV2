import { chromium, expect } from '@playwright/test';

// Hold preparation and provider responses separately to reproduce the races.
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/keys', route => route.fulfill({ json: { openai: true, local: true } }));
  const audio = [], calls = [];
  await page.route('**/api/iconik/connect', route => route.fulfill({ json: { connected: true } }));
  await page.route('**/api/iconik/resolve', route => {
    const assetId = JSON.parse(route.request().postData()).link.match(/asset\/([^/]+)/)[1];
    return route.fulfill({ json: { assetId, proxyId: assetId, name: `Source ${assetId}`, url: '', audioUrl: `/api/iconik/audio/${assetId}` } });
  });
  await page.route('**/api/iconik/audio/*', route => { audio.push(route); });
  await page.route('**/api/transcribe', route => { calls.push(route); });
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.keyboard.press('F2');
  const open = name => page.locator(`.drawer-tab button[title="${name}"]`).click();
  const start = () => page.getByRole('button', { name: /Transcribe.*Sub A/, exact: true });
  const progress = page.getByRole('progressbar', { name: 'Transcription progress' });
  const cancel = () => page.getByRole('button', { name: 'Cancel transcription', exact: true }).click();
  const importAsset = async id => {
    await page.getByRole('button', { name: 'Add media', exact: true }).click();
    await page.getByRole('button', { name: 'Iconik', exact: true }).click();
    await page.getByLabel('Iconik asset link').fill(`https://app.iconik.io/asset/${id}/`);
    await page.getByRole('button', { name: 'Import / reconnect asset', exact: true }).click();
    await expect(page.getByText(`Imported Source ${id}. Playback is ready; audio extraction runs in the background.`)).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  };
  const completeAudio = route => route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from(new Float32Array(16000).fill(.05).buffer) });
  const result = text => ({ text, words: text.split(' ').map((word, i) => ({ word, start: i * .3, end: (i + 1) * .3 })), segments: [{ text, start: 0, end: .9 }] });
  const project = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('transcriber', 1); req.onsuccess = () => resolve(req.result); });
    const value = await new Promise(resolve => { const req = db.transaction('projects').objectStore('projects').get('current'); req.onsuccess = () => resolve(req.result); });
    db.close(); return value;
  });
  const cueText = (doc, id) => doc?.media?.[`iconik_${id}`] ? (doc.media[`iconik_${id}`].cues || []).map(c => c.textOverride || c.orig?.text || '').join(' ') : null;

  await open('Transcribe');
  await expect(progress).toHaveCount(0);
  await importAsset('first');
  await expect.poll(() => audio.length).toBe(1);
  await expect(page.getByRole('status', { name: 'Media audio preparation' })).toBeVisible();
  await expect(start()).toBeEnabled();
  await expect(progress).toHaveCount(0);
  expect(calls.length).toBe(0);

  // Cancel while waiting for shared import audio. Completion must not start ASR.
  await start().click();
  await expect(progress).toBeVisible();
  await cancel();
  await expect(progress).toHaveCount(0);
  await completeAudio(audio[0]);
  await expect(page.getByRole('status', { name: 'Media audio preparation' })).toHaveCount(0);
  expect(calls.length).toBe(0);
  await expect.poll(async () => cueText(await project(), 'first')).toBe('');
  console.log('Idle import and preparation cancellation passed.');

  // Duplicate clicks, alignment conflict, and a late cancelled response.
  await start().evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => calls.length).toBe(1);
  await open('Align');
  await page.getByPlaceholder(/Paste subtitle lines here/).fill('Kept subtitle text.');
  await expect(page.getByRole('button', { name: /Align-To-Audio/ })).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Alignment progress' })).toHaveCount(0);
  await open('Transcribe');
  await cancel();
  await start().click();
  await expect.poll(() => calls.length).toBe(2);
  console.log('Duplicate guard and replacement request started.');
  await calls[0].fulfill({ json: result('Cancelled stale speech.') }).catch(() => {});
  await expect(progress).toBeVisible();
  await expect.poll(async () => cueText(await project(), 'first')).toBe('');

  // A second source finishes import while the first source is transcribing.
  await importAsset('second');
  await expect.poll(() => audio.length).toBe(2);
  await completeAudio(audio[1]);
  await expect(page.getByRole('status', { name: 'Media audio preparation' })).toHaveCount(0);
  await expect(progress).toBeVisible();
  await expect(page.getByText('Transcribing Source first', { exact: true })).toBeVisible();
  expect(calls.length).toBe(2);
  await calls[1].fulfill({ json: result('Current accepted speech.') });
  await expect(progress).toHaveCount(0);
  await expect.poll(async () => cueText(await project(), 'first')).toBe('Current accepted speech.');
  await expect.poll(async () => cueText(await project(), 'second')).toBe('');
  console.log('Late response and concurrent source import passed.');

  // Provider failure releases the task, then a retry succeeds.
  await start().click();
  await expect.poll(() => calls.length).toBe(3);
  await calls[2].fulfill({ status: 500, json: { error: { message: 'Fixture provider failure' } } });
  await expect(page.getByText(/Transcribe failed:.*Fixture provider failure/)).toBeVisible();
  await expect(progress).toHaveCount(0);
  await start().click();
  await expect.poll(() => calls.length).toBe(4);
  await calls[3].fulfill({ json: result('Second accepted speech.') });
  await expect(progress).toHaveCount(0);
  await expect.poll(async () => cueText(await project(), 'second')).toBe('Second accepted speech.');

  // An alignment task has its own progress and cannot launch transcription.
  await open('Align');
  await page.getByRole('button', { name: /Align-To-Audio/ }).click();
  await expect.poll(() => calls.length).toBe(5);
  await expect(page.getByRole('progressbar', { name: 'Alignment progress' })).toBeVisible();
  await open('Transcribe');
  await expect(start()).toBeDisabled();
  await expect(progress).toHaveCount(0);
  await open('Align');
  await page.getByRole('button', { name: 'Cancel alignment', exact: true }).click();
  await calls[4].fulfill({ json: result('Cancelled alignment speech.') }).catch(() => {});
  await expect(page.getByRole('progressbar', { name: 'Alignment progress' })).toHaveCount(0);
  await expect.poll(async () => cueText(await project(), 'second')).toBe('Second accepted speech.');
  // Native worker failure must release progress; cancellation must terminate it.
  await page.evaluate(() => {
    window.workerRuns = 0; window.workerStops = 0;
    window.Worker = class extends EventTarget {
      postMessage() {
        window.workerRuns++;
        if (window.workerRuns === 1) queueMicrotask(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Fixture worker crash' })));
      }
      terminate() { window.workerStops++; }
    };
  });
  await open('Transcribe');
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await start().click();
  await expect(page.getByText('Local transcribe failed: Fixture worker crash', { exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  await start().click();
  await expect.poll(() => page.evaluate(() => window.workerRuns)).toBe(2);
  await expect(progress).toBeVisible();
  await cancel();
  await expect.poll(() => page.evaluate(() => window.workerStops)).toBe(2);
  await expect(progress).toHaveCount(0);
  await expect.poll(async () => cueText(await project(), 'second')).toBe('Second accepted speech.');
  expect(errors).toEqual([]);
  console.log('Transcription browser checks passed: idle import, cancel during preparation/request, late response isolation, duplicate clicks, source switch, background completion, provider failure/retry, alignment ownership, worker crash/retry/cancel.');
} finally { await browser?.close(); }
