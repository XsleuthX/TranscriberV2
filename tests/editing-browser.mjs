import { chromium, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
const directory = await mkdtemp(path.join(tmpdir(), 'transcriber-editing-'));
let browser;
try {
  for (const [name, size] of [['portrait', '180x320'], ['square', '320x320'], ['wide', '480x180'], ['four-three', '320x240']]) {
    const result = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=10:d=8`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', path.join(directory, name + '.mp4')], { windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr.toString());
  }
  const sound = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', path.join(directory, 'sound.wav')], { windowsHide: true });
  if (sound.status !== 0) throw new Error(sound.stderr.toString());
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/keys', route => route.fulfill({ json: { openai: true, deepseek: true, local: true } }));
  await page.route('**/editing-fixtures/*', async route => {
    const filename = path.basename(new URL(route.request().url()).pathname), bytes = await readFile(path.join(directory, filename));
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || ''), type = filename.endsWith('.wav') ? 'audio/wav' : 'video/mp4';
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : bytes.length - 1;
      await route.fulfill({ status: 206, contentType: type, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
    } else await route.fulfill({ contentType: type, body: bytes });
  });
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  await expect(page.getByText('All changes saved')).toBeVisible();
  const words = [['bad', 0, .4], ['word,', .4, .9], ['bad', 3, 3.4], ['word.', 3.4, 3.9]].map(([t, s, e], i) => ({ t, s, e, i, sp: 'S1' }));
  const cues = [{ id: 'first', ws: 0, we: 1, orig: { start: 0, end: .9, text: 'bad word,' } }, { id: 'second', ws: 2, we: 3, orig: { start: 3, end: 3.9, text: 'bad word.' } }];
  const media = Object.fromEntries(['portrait', 'square', 'wide', 'four-three', 'sound'].map(key => [key, {
    name: key, type: 'iconik', iconik: { assetId: key }, url: `/editing-fixtures/${key}.${key === 'sound' ? 'wav' : 'mp4'}`, duration: 8,
    mediaKind: key === 'sound' ? 'audio' : 'video', words: structuredClone(words), cues: structuredClone(cues), clips: [],
    cuesB: cues.map(c => ({ ...c, id: c.id + '_B', textOverride: 'mauvais mot.', startOverride: c.orig.start, endOverride: c.orig.end })),
  }]));
  const rows = [{ id: 'story', label: 'Story', cards: [{ id: 'portrait-card', assetKey: 'portrait', kind: 'cue', col: 'video', label: 'Interview', title: '', body: '', cueRefs: ['first', 'second'], sourceCueRefs: ['first', 'second'], sin: 0, sout: 3.9 }] }];
  media.wide.cues = media.wide.cues.map(c => ({ ...c, ws: null, we: null, startOverride: c.orig.start, endOverride: c.orig.end, textOverride: c.orig.text }));
  await page.evaluate(async value => {
    value.media.portrait.pcm = new Int16Array(16000 * 8).fill(1000).buffer;
    const db = await new Promise(r => { const req = indexedDB.open('transcriber', 1); req.onsuccess = () => r(req.result); });
    await new Promise(r => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(value, 'current'); tx.oncomplete = r; }); db.close();
  }, { activeAsset: 'portrait', media, rows });
  await page.reload();
  const project = () => page.evaluate(async () => {
    const db = await new Promise(r => { const req = indexedDB.open('transcriber', 1); req.onsuccess = () => r(req.result); });
    const value = await new Promise(r => { const req = db.transaction('projects').objectStore('projects').get('current'); req.onsuccess = () => r(req.result); }); db.close(); return value;
  });
  await page.getByRole('button',{name:'Find',exact:true}).click();
  await page.getByRole('button',{name:'Replace…',exact:true}).click();
  const find = page.getByLabel('Find text'), replacement = page.getByLabel('Replace with');
  const selectMedia = name => page.locator('.asset').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).click();
  const track = page.locator('.barsel[title="Which subtitle track this view reads and writes"]');
  const open = name => page.locator(`.drawer-tab button[title="${name}"]`).click();
  const textOf = c => c.textOverride ?? c.orig?.text;
  const renderedFrame = () => expect.poll(() => page.locator('.viewer video').evaluate(video => {
    if (video.readyState < 2 || video.seeking) return false;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 16, 16);
    return context.getImageData(0, 0, 16, 16).data.some((v, i) => i % 4 !== 3 && v > 40);
  })).toBe(true);
  await page.keyboard.press('F1');
  await expect(page.getByRole('toolbar', { name: 'Find and replace' })).toBeVisible();
  await find.fill('BAD'); await replacement.fill('good');
  await expect(page.getByRole('status', { name: 'Find matches' })).toContainText('2 matches');
  await page.getByLabel('Match case', { exact: true }).check();
  await expect(page.getByRole('status', { name: 'Find matches' })).toContainText('0 matches');
  await page.getByLabel('Match case', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Next match', exact: true }).click();
  await expect.poll(() => page.locator('.viewer video').evaluate(el => el.currentTime)).toBeCloseTo(0, 2);
  await page.getByRole('button', { name: 'Next match', exact: true }).click();
  await expect.poll(() => page.locator('.viewer video').evaluate(el => el.currentTime)).toBeCloseTo(3, 2);
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await expect.poll(async () => (await project()).media.portrait.words.map(w => w.t)).toEqual(['good', 'word,', 'good', 'word.']);
  let saved = await project();
  expect(saved.media.portrait.cues.map(textOf)).toEqual(['good word,', 'good word.']);
  expect(saved.media.square.words.map(w => w.t)).toEqual(words.map(w => w.t));
  expect(saved.media.portrait.cuesB.map(textOf)).toEqual(['mauvais mot.', 'mauvais mot.']);
  expect(saved.rows[0].cards[0].cueRefs).toEqual(['first', 'second']);
  expect(saved.media.portrait.cues.map(c => [c.startOverride, c.endOverride])).toEqual([[0, .9], [3, 3.9]]);
  await page.getByRole('button', { name: /Undo/ }).first().click();
  await expect.poll(async () => (await project()).media.portrait.words.map(w => w.t)).toEqual(words.map(w => w.t));
  await page.getByRole('button', { name: /Redo/ }).first().click();
  await expect.poll(async () => (await project()).media.portrait.words[0].t).toBe('good');
  await page.keyboard.press('F2'); await find.fill(','); await replacement.fill('!');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(async () => textOf((await project()).media.portrait.cues[0])).toBe('good word!');
  await track.selectOption('B'); await find.fill('mauvais'); await replacement.fill('meilleur');
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await expect.poll(async () => (await project()).media.portrait.cuesB.map(textOf)).toEqual(['meilleur mot.', 'meilleur mot.']);
  await track.selectOption('DUAL'); await page.getByLabel('Find subtitle track').selectOption('B');
  await find.fill('meilleur'); await expect(page.getByRole('status', { name: 'Find matches' })).toContainText('2 matches');
  await page.getByRole('button', { name: 'Next match', exact: true }).click();
  await expect(page.locator('.vcc')).toHaveText('meilleur mot.');
  await track.selectOption('A');
  await selectMedia('wide'); await page.keyboard.press('F1');
  await find.fill('bad'); await replacement.fill('better');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(async () => (await project()).media.wide.cues.map(textOf)).toEqual(['better word,', 'bad word.']);
  await expect.poll(async () => (await project()).media.wide.words.map(w => w.t)).toEqual(['better', 'word,', 'bad', 'word.']);
  await selectMedia('portrait');
  console.log('Transcript/subtitle replace, A/B scope, timing, Story refs and undo passed.');

  // Check the media box has the actual ratio and fits inside the viewer.
  for (const [name, ratio] of [['portrait', 180 / 320], ['square', 1], ['wide', 480 / 180], ['four-three', 4 / 3]]) {
    await selectMedia(name);
    await expect.poll(() => page.locator('.viewer video').evaluate(el => el.videoWidth / el.videoHeight)).toBeCloseTo(ratio, 3);
    await renderedFrame();
    await expect.poll(async () => { const box = await page.getByLabel('Source player').boundingBox(); return box.width / box.height; }).toBeCloseTo(ratio, 2);
    const stage = await page.getByLabel('Source player').boundingBox(), viewer = await page.locator('.viewer').boundingBox();
    expect(stage.y + stage.height).toBeLessThan(viewer.y + viewer.height);
  }
  await selectMedia('sound'); await expect(page.getByRole('img', { name: 'Audio media' })).toBeVisible();
  await expect(page.locator('.viewer audio')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('.viewer audio').evaluate(el => el.currentTime)).toBeGreaterThan(.15);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Add media', exact: true }).click();
  await page.locator('input[type="file"][accept="video/*,audio/*"]').first().setInputFiles(path.join(directory, 'sound.wav'));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Audio media' })).toBeVisible();
  await expect(page.locator('.vhead')).toHaveText('sound.wav');
  await expect(page.getByText('Audio ready. Run Transcribe from the drawer.')).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('F4');
  const card = page.locator('[data-card-id="portrait-card"]');
  await card.locator('[data-story-cue="second"]').click();
  await expect.poll(() => page.locator('.viewer video').evaluate(el => el.currentTime)).toBeCloseTo(3, 2);
  await renderedFrame();
  await expect(page.locator('.vhead')).toHaveText('portrait');
  await card.getByRole('button', { name: 'Edit cues', exact: true }).click();
  await selectMedia('square'); await card.locator('.mtxt').first().click();
  await expect(page.locator('.vhead')).toHaveText('portrait');
  await expect.poll(() => page.locator('.viewer video').evaluate(el => el.currentTime)).toBeCloseTo(0, 2);
  await renderedFrame();
  await expect(card).toHaveCount(1);
  await page.screenshot({ path: path.join(process.env.TEMP || tmpdir(), 'editing-preview.png') });
  console.log('Portrait/square/wide/4:3 rendering, audio playback and source-scoped Story line preview passed.');

  // An incomplete assistant answer stays visible and continuation uses it.
  const aiCalls = [];
  await page.route('**/api/ai', route => {
    aiCalls.push(JSON.parse(route.request().postData()));
    return route.fulfill({ json: { content: [{ type: 'text', text: aiCalls.length === 1 ? 'Partial answer.' : 'Completed answer.' }], ...(aiCalls.length === 1 ? { incomplete: true, warning: 'Output incomplete; partial answer kept.' } : {}) } });
  });
  await open('AI Assistant');
  await page.locator('.drawer select').filter({ has: page.locator('option[value="deepseek"]') }).selectOption('deepseek');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('AI assistant output')).toHaveValue('Partial answer.');
  await page.getByRole('button', { name: 'Continue output', exact: true }).click();
  await expect(page.getByLabel('AI assistant output')).toHaveValue('Partial answer.\nCompleted answer.');
  expect(aiCalls[0].max_tokens).toBe(8192);
  expect(aiCalls[1].messages.some(m => m.role === 'assistant' && m.content === 'Partial answer.')).toBe(true);
  console.log('AI larger budget, partial retention and continuation passed.');

  // Align uses Whisper even when another speech model is selected.
  const alignmentCalls = [];
  let responseWords = [
    { word: '你好', start: 0, end: .5 }, { word: '世界', start: .5, end: 1 },
    { word: '第二句', start: 3, end: 4 }, { word: '第三句', start: 6, end: 7 },
  ];
  let heldAlignment;
  await page.route('**/api/transcribe', route => {
    alignmentCalls.push(route.request().headers());
    if (alignmentCalls.length > 1) { heldAlignment = route; return; }
    return route.fulfill({ json: { words: responseWords } });
  });
  await open('Transcribe'); await page.getByLabel('Transcription model').selectOption('gpt-4o-mini-transcribe');
  await open('Align');
  const lines = ['  你好，世界！  ', '第二句。', '第三句！'];
  await page.getByPlaceholder(/Paste subtitle lines here/).fill(lines.join('\n'));
  await page.getByRole('button', { name: /Align-To-Audio/ }).click();
  await expect(page.getByText(/3 lines aligned/)).toBeVisible();
  await expect.poll(async () => (await project()).media.portrait.cues.map(textOf)).toEqual(lines);
  saved = await project();
  expect(saved.media.portrait.cues.map(c => [c.startOverride, c.endOverride])).toEqual([[0, 1], [3, 4], [6, 7]]);
  expect(alignmentCalls.map(c => c['x-model'])).toEqual(['whisper-1']);
  await expect(page.getByPlaceholder(/Paste subtitle lines here/)).toHaveValue(lines.join('\n'));
  await page.reload();
  await expect.poll(async () => (await project()).media.portrait.cues.map(textOf)).toEqual(lines);
  responseWords = [
    { word: 'Hello', start: 0, end: .5 }, { word: 'world', start: .5, end: 1 },
    { word: 'Second', start: 3, end: 3.5 }, { word: 'line', start: 3.5, end: 4 },
    { word: 'Hello', start: 6, end: 6.3 }, { word: 'world', start: 6.3, end: 6.6 }, { word: 'again', start: 6.6, end: 7 },
  ];
  await open('Align');
  const english = ['Hello, world!', 'Second line.', 'Hello world again.'];
  await page.getByPlaceholder(/Paste subtitle lines here/).fill(english.join('\n'));
  await page.getByRole('button', { name: /Align-To-Audio/ }).click();
  await expect.poll(() => alignmentCalls.length).toBe(2);
  await selectMedia('square');
  await heldAlignment.fulfill({ json: { words: responseWords } });
  await expect.poll(async () => (await project()).media.portrait.cues.map(textOf)).toEqual(english);
  saved = await project();
  expect(saved.media.portrait.cues.map(c => [c.startOverride, c.endOverride])).toEqual([[0, 1], [3, 4], [6, 7]]);
  expect(saved.media.square.cues.map(textOf)).toEqual(['bad word,', 'bad word.']);
  expect(saved.media.portrait.cuesB.map(textOf)).toEqual(['meilleur mot.', 'meilleur mot.']);
  expect(errors).toEqual([]);
  console.log('English/CJK line alignment, exact text, all timings, Whisper selection, source switching, translation preservation, and reload passed.');
} finally { await browser?.close(); await rm(directory, { recursive: true, force: true }); }
