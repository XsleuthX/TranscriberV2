import { chromium, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const directory = await mkdtemp(path.join(tmpdir(), 'transcriber-browser-'));
let browser, testPage;
try {
  for (const [name, color, frequency, duration] of [['red', 'red', 440, 8], ['blue', 'blue', 880, 4]]) {
    const result = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=25:d=${duration}`,
      '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', '-shortest', path.join(directory, name + '.mp4')], { windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr?.toString() || 'Fixture generation failed');
  }
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  testPage = page;
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  await page.route('**/api/keys', route => route.fulfill({ json: { openai: true, local: true } }));
  await page.route('**/fixtures/*.mp4', async route => {
    const file = path.basename(new URL(route.request().url()).pathname);
    const data = await readFile(path.join(directory, file));
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : data.length - 1;
      await route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${data.length}` }, body: data.subarray(start, end + 1) });
    } else await route.fulfill({ status: 200, contentType: 'video/mp4', body: data });
  });
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  await expect(page.getByText('All changes saved')).toBeVisible();
  const tracks = [
    { id: 'V2', name: 'V2', kind: 'video', height: 46, visible: true },
    { id: 'V1', name: 'V1', kind: 'video', height: 46, visible: true },
    { id: 'A1', name: 'A1', kind: 'audio', height: 38 },
    { id: 'A2', name: 'A2', kind: 'audio', height: 38 },
    { id: 'SUB', name: 'Subtitle', kind: 'subtitle', height: 26, visible: true },
  ];
  const c = (id, trackId, kind, assetKey, pin, pout, sin, extra = {}) =>
    ({ id, title: id, trackId, kind, assetKey, pin, pout, sin, sout: sin + pout - pin, color: '#2a6e78', ...extra });
  const clips = [c('red-base', 'V1', 'video', 'red', 0, 3, 1, { groupId: 'red' }),
    c('red-audio', 'A1', 'audio', 'red', 0, 3, 1, { groupId: 'red' }),
    c('blue-overlay', 'V2', 'video', 'blue', 1, 2.5, .5, { groupId: 'blue' }),
    c('blue-audio', 'A2', 'audio', 'blue', 1, 2.5, .5, { groupId: 'blue' }),
    c('blue-next', 'V1', 'video', 'blue', 3, 5, 2), c('blue-next-audio', 'A1', 'audio', 'blue', 3, 5, 2),
    c('tail', 'V1', 'video', 'red', 6, 7, 5),
    c('caption', 'SUB', 'subtitle', 'blue', 1, 2.5, .5, { text: 'PROJECT-TIME CAPTION', groupId: 'blue' })];
  const empty = { words: [], cues: [], cuesB: [], clips: [], type: 'local' };
  const project = { activeAsset: 'blue', media: {
    red: { ...empty, name: 'Red source', url: '/fixtures/red.mp4', duration: 8 },
    blue: { ...empty, name: 'Blue source', url: '/fixtures/blue.mp4', duration: 4 },
  }, rows: [], mtl: { tracks, clips, markers: [] } };
  await page.evaluate(async doc => {
    const db = await new Promise(resolve => { const r = indexedDB.open('transcriber', 1); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(doc, 'current'); tx.oncomplete = resolve; });
    db.close();
  }, project);
  await page.reload();
  await expect(page.getByText('Blue source', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('F5');
  const monitor = page.getByLabel('Program monitor');
  await expect(monitor).toBeVisible();
  const seek = async seconds => {
    const box = await page.locator('.viewer .vscrub').boundingBox();
    await page.mouse.click(box.x + box.width * seconds / 7, box.y + box.height / 2);
  };
  await seek(1.5);
  await expect(monitor.locator('video')).toHaveCount(2);
  await expect(monitor.locator('audio')).toHaveCount(2);
  await expect(monitor.getByText('PROJECT-TIME CAPTION')).toBeVisible();
  await expect.poll(() => monitor.locator('video').first().evaluate(el => el.currentTime)).toBeCloseTo(2.5, 1);
  await expect.poll(() => monitor.locator('video').last().evaluate(el => el.currentTime)).toBeCloseTo(1, 1);
  await expect.poll(() => monitor.locator('video').evaluateAll(videos => videos.every(v => !v.seeking && v.readyState >= 2))).toBe(true);
  const pixels = await monitor.locator('video').evaluateAll(videos => videos.map(v => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(v, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];
  }));
  if (pixels[0][0] < 200 || pixels[1][2] < 200) throw new Error('Source frame colors were incorrect: ' + JSON.stringify(pixels));
  // UI track controls drive actual playback nodes.
  const heads = page.locator('.tlwrap button[title^="Visible"]');
  await heads.first().click(); await expect(monitor.locator('video')).toHaveCount(1);
  await heads.first().click(); await expect(monitor.locator('video')).toHaveCount(2);
  await page.locator('.tlwrap button[title^="Solo"]').last().click();
  await expect(monitor.locator('audio')).toHaveCount(1);
  await page.locator('.tlwrap button[title^="Solo"]').last().click();
  await seek(5.5); await expect(monitor.locator('video')).toHaveCount(0);
  await seek(6.5); await expect(monitor.locator('video')).toHaveCount(1);
  await expect.poll(() => monitor.locator('video').evaluate(el => el.currentTime)).toBeCloseTo(5.5, 1);
  // Program duration exceeds the selected source's duration, and playback crosses cuts.
  await seek(.5); await page.keyboard.press('Space');
  await expect(monitor.getByText('PROJECT-TIME CAPTION')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => monitor.locator('video').evaluateAll(v => v.length === 1 && v[0].src.endsWith('/blue.mp4')), { timeout: 7000 }).toBe(true);
  await expect.poll(() => monitor.locator('audio').evaluateAll(a => a.length === 1 && !a[0].paused), { timeout: 4000 }).toBe(true);
  await page.keyboard.press('Space');
  await seek(1.5);
  await expect.poll(() => monitor.locator('video').evaluateAll(v => v.length === 2 && v.every(el => !el.seeking && el.readyState >= 2))).toBe(true);
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH });
  // Multi-selection editing is undoable with one keyboard gesture.
  const red = page.locator('[data-track-id="V1"] .mtlclip').filter({ hasText: 'red-base' });
  await red.click();
  await page.getByLabel('Opacity', { exact: true }).fill('0.5');
  await page.getByLabel('Opacity', { exact: true }).blur();
  await expect(monitor.locator('video').first()).toHaveCSS('opacity', '0.5');
  await page.locator('.tlstat').click();
  await page.keyboard.press('Control+z');
  await expect(monitor.locator('video').first()).toHaveCSS('opacity', '1');
  // Existing local import still decodes real media.
  await page.getByRole('button', { name: 'Add media', exact: true }).click();
  await page.locator('input[type="file"][accept="video/*,audio/*"]').first().setInputFiles(path.join(directory, 'red.mp4'));
  await expect(page.getByText('red.mp4', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Audio ready. Run Transcribe from the drawer.')).toBeVisible({ timeout: 15000 });
  // Import via the actual Iconik form, then run the existing transcript workflow.
  const assetId = '11111111-1111-1111-1111-111111111111';
  await page.route('**/api/iconik/connect', route => route.fulfill({ json: { connected: true } }));
  await page.route('**/api/iconik/resolve', route => route.fulfill({ json: {
    assetId, proxyId: '22222222-2222-2222-2222-222222222222', name: 'Iconik test footage',
    url: '/fixtures/blue.mp4', audioUrl: '/api/iconik/audio/test-fixture',
  } }));
  await page.route('**/api/iconik/audio/test-fixture', route => route.fulfill({
    contentType: 'application/octet-stream', body: Buffer.from(new Float32Array(16000).fill(.05).buffer),
  }));
  let transcriptBytes = 0;
  await page.route('**/api/transcribe', route => {
    transcriptBytes = route.request().postDataBuffer()?.length || 0;
    return route.fulfill({ json: { text: 'Imported speech.',
      words: [{ word: 'Imported', start: 0, end: .4 }, { word: 'speech.', start: .4, end: .9 }],
      segments: [{ text: 'Imported speech.', start: 0, end: .9 }],
    } });
  });
  await page.getByRole('button', { name: 'Iconik', exact: true }).click();
  await page.getByLabel('Iconik asset link').fill(`https://app.iconik.io/asset/${assetId}/`);
  await page.getByLabel('Iconik API token').fill('fixture-token');
  await page.getByRole('button', { name: 'Import / reconnect asset', exact: true }).click();
  await expect(page.getByLabel('Iconik API token')).toHaveValue('');
  await expect(page.getByText('Iconik audio ready. Use Transcribe, Subtitles, and Story as usual.')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('F2');
  await page.locator('.drawer-tab button[title="Transcribe"]').click();
  await page.getByRole('button', { name: 'Transcribe → Sub A', exact: true }).click();
  await expect(page.getByText('Imported speech.', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  if (transcriptBytes < 32000) throw new Error('Transcription did not receive the extracted audio');
  // New speech model selection must send its ID, then request Whisper timing.
  const speechCalls = [];
  await page.route('**/api/transcribe', route => {
    const model = route.request().headers()['x-model']; speechCalls.push(model);
    return route.fulfill({ json: model === 'whisper-1' ? {
      text: 'Imported speech.', words: [{ word: 'Imported', start: 0, end: .4 }, { word: 'speech.', start: .4, end: .9 }],
      segments: [{ text: 'Imported speech.', start: 0, end: .9 }],
    } : { text: 'Imported revised speech.' } });
  });
  await page.getByLabel('Transcription model').selectOption('gpt-4o-mini-transcribe');
  await page.getByRole('button', { name: /Transcribe.*Sub A/, exact: true }).click();
  await expect(page.getByText('Imported revised speech.', { exact: true }).first()).toBeVisible();
  if (speechCalls[0] !== 'gpt-4o-mini-transcribe' || speechCalls[1] !== 'whisper-1') throw new Error('Selected speech model/timing pass not used: ' + speechCalls);
  // Force browser decode failure and one transient slice read failure. The
  // import-to-transcribe race must share one real FFmpeg extraction job.
  await page.route('**/api/keys', route => route.fulfill({ json: { openai: true } }));
  await page.addInitScript(() => {
    let failed = false;
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      if (!failed && this.size > 1000) { failed = true; return Promise.reject(new DOMException('Temporary read failure', 'NotReadableError')); }
      return read.call(this);
    };
    AudioContext.prototype.decodeAudioData = async () => { throw new DOMException('Unsupported camera audio', 'EncodingError'); };
  });
  await page.reload();
  let mediaStarts = 0;
  page.on('request', req => { if (req.url().includes('/api/media/start')) mediaStarts++; });
  await page.route('**/api/media/status?*', async route => {
    await new Promise(r => setTimeout(r, 1200)); await route.continue();
  });
  await page.getByRole('button', { name: 'Add media', exact: true }).click();
  await page.locator('input[type="file"][accept="video/*,audio/*"]').first().setInputFiles(path.join(directory, 'red.mp4'));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('F2');
  await page.locator('.drawer-tab button[title="Transcribe"]').click();
  await page.getByRole('button', { name: /Transcribe.*Sub A/, exact: true }).click();
  await expect(page.getByText('Imported speech.', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  if (mediaStarts !== 1) throw new Error('Import and Transcribe started competing media jobs: ' + mediaStarts);
  // Once cached, even a now-unreadable source must not be read again.
  await page.evaluate(() => { Blob.prototype.arrayBuffer = async () => { throw new DOMException('Stale file', 'NotReadableError'); }; });
  await page.getByRole('button', { name: /Transcribe.*Sub A/, exact: true }).click();
  await expect(page.getByText('Imported speech.', { exact: true }).first()).toBeVisible();
  if (mediaStarts !== 1) throw new Error('Cached audio was not reused');
  // Two assets intentionally share cue IDs. Edits must remain source-scoped.
  const story = structuredClone(project);
  const sourceCues = (text, prefix) => ({
    words: text.split(' ').map((t, i) => ({ i, t, s: i * .5, e: i * .5 + .4, sp: 'S1' })),
    cues: [{ id: 'shared', ws: 0, we: 2, textOverride: text, orig: { start: 0, end: 1.4, text } }],
    cuesB: [{ id: 'shared_B', ws: 0, we: 2, textOverride: prefix, orig: { start: 0, end: 1.4, text: prefix } }],
  });
  Object.assign(story.media.red, sourceCues('Red original words.', 'Rouge original.'));
  Object.assign(story.media.blue, sourceCues('Blue original words.', 'Bleu original.'));
  const card = (id, assetKey) => ({ id, assetKey, kind: 'cue', col: 'video', label: 'Interview', title: id, body: '', cueRefs: ['shared'], sourceCueRefs: ['shared'], sin: 0, sout: 1.4 });
  story.rows = [{ id: 'story-row', label: 'Assembly', cards: [card('red-card', 'red'), card('blue-card', 'blue')] }];
  await expect(page.getByText('All changes saved')).toBeVisible();
  const saveProject = async doc => page.evaluate(async value => {
    const db = await new Promise(r => { const request = indexedDB.open('transcriber', 1); request.onsuccess = () => r(request.result); });
    await new Promise(r => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(value, 'current'); tx.oncomplete = r; }); db.close();
  }, doc);
  await saveProject(story); await page.reload(); await page.keyboard.press('F4');
  const redBody = page.locator('.dcard').first().locator('.dbody'), blueBody = page.locator('.dcard').nth(1).locator('.dbody');
  await expect(redBody).toHaveText('Red original words.');
  await redBody.focus(); await page.locator('.asset').filter({ hasText: 'Blue source' }).click();
  await expect(page.locator('.dcard')).toHaveCount(2); await expect(redBody).toHaveText('Red original words.');
  await redBody.fill('Red revised words.'); await blueBody.click();
  await expect(redBody).toHaveText('Red revised words.'); await expect(blueBody).toHaveText('Blue original words.');
  await page.locator('.dcard').first().getByRole('button', { name: 'Edit cues', exact: true }).click();
  await page.locator('.dcard').first().locator('.mtxt').fill('Red mini edited words.');
  await blueBody.click();
  await expect(page.locator('.dcard').first().locator('.mtxt')).toHaveText('Red mini edited words.');
  await expect(blueBody).toHaveText('Blue original words.');
  await page.locator('.barsel[title="Which subtitle track this view reads and writes"]').selectOption('B');
  await expect(page.locator('.dcard').first().locator('.mtxt')).toHaveText('Rouge original.');
  await page.locator('.dcard').first().locator('.mtxt').fill('Rouge revised.'); await blueBody.click();
  await expect(blueBody).toHaveText('Bleu original.');
  await page.locator('.barsel[title="Which subtitle track this view reads and writes"]').selectOption('A');
  await expect(page.locator('.dcard').first().locator('.mtxt')).toHaveText('Red mini edited words.');
  await page.locator('.drawer-tab button[title="Translate"]').click();
  await page.locator('.drawer select').filter({ has: page.locator('option[value="openai"]') }).selectOption('openai');
  const textModel = page.locator('.drawer select').filter({ has: page.locator('option[value="gpt-6.1-sol"]') });
  await textModel.selectOption('gpt-6.1-sol'); await expect(textModel).toHaveValue('gpt-6.1-sol');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload(); await page.keyboard.press('F4');
  await expect(page.locator('.dcard')).toHaveCount(2);
  await expect(page.locator('.dcard').first().locator('.mtxt')).toHaveText('Red mini edited words.');
  await expect(page.locator('.dcard').nth(1).locator('.dbody')).toHaveText('Blue original words.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Browser checks passed: timeline playback/editing, Iconik flow, selected speech model + timing pass, transient read recovery + real FFmpeg fallback, import/transcribe job reuse, source-scoped Story edits in A/B, model picker, and project reload.');
} catch (error) {
  console.error(await testPage?.locator('[aria-label="Program monitor"]').evaluate(el => ({ text: el.innerText,
    media: [...el.querySelectorAll('video,audio')].map(v => ({ src: v.src, time: v.currentTime, ready: v.readyState, error: v.error?.message })) })).catch(() => null));
  throw error;
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
