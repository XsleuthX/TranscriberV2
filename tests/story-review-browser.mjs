import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/keys', route => route.fulfill({ json: { anthropic: true } }));
  let answer = items => ({ flags: [] });
  await page.route('**/api/ai', route => {
    const prompt = route.request().postDataJSON().messages[0].content;
    const items = JSON.parse(prompt.split('PROJECT ITEMS:\n')[1]); requests.push(items);
    const response = answer(items, prompt);
    return route.fulfill({ json: { content: [{ type: 'text', text: typeof response === 'string' ? response : JSON.stringify(response) }] } });
  });
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  const read = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('transcriber', 1); req.onsuccess = () => resolve(req.result); });
    const result = await new Promise(resolve => { const req = db.transaction('projects').objectStore('projects').get('current'); req.onsuccess = () => resolve(req.result); }); db.close(); return result;
  });
  await expect.poll(async () => !!(await read())?.mtl).toBe(true);
  const original = await read();
  const texts = ['Opening sentence.', 'Bridge sentence.', 'Closing sentence.'];
  const words = texts.map((t, i) => ({ t, i, s: i * 4, e: i * 4 + 2, sp: 'S1' }));
  const cues = texts.map((text, i) => ({ id: 'cue' + i, ws: i, we: i, textOverride: text, startOverride: i * 4, endOverride: i * 4 + 2 }));
  const fixture = { ...original, reviews: [], activeAsset: 'two', media: Object.fromEntries(['one', 'two'].map(key => [key, { name: key, type: 'local', url: null, duration: 12, words, cues,
    cuesB: cues.map(c => ({ ...c, id: c.id + '_B', textOverride: c.textOverride + ' translated' })), clips: [] }])),
    rows: [{ id: 'row', label: 'Story', cards: [{ id: 'card', assetKey: 'one', kind: 'cue', col: 'video', label: 'Interview', cueRefs: cues.map(c => c.id), sourceCueRefs: cues.map(c => c.id), sin: 0, sout: 10 }] }] };
  const seed = async () => {
    await page.evaluate(async value => {
      const db = await new Promise(resolve => { const req = indexedDB.open('transcriber', 1); req.onsuccess = () => resolve(req.result); });
      await new Promise(resolve => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(value, 'current'); tx.oncomplete = resolve; }); db.close();
    }, fixture); await page.reload(); await expect(page.locator('.asset b').filter({ hasText: /^one$/ })).toBeVisible(); await page.keyboard.press('F4');
  };
  const undo = () => page.getByRole('button', { name: /Undo/ }).first().click();
  const removeLine = async index => {
    const body = page.locator('.dbody').first(); await body.focus();
    await body.evaluate((el, at) => {
      const span = el.querySelectorAll('[data-story-cue]')[at], range = document.createRange(); range.selectNode(span);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, index);
    await page.keyboard.press('Backspace');
    await body.press('Tab');
  };
  for (const [index, refs, range] of [[0, ['cue1', 'cue2'], [4, 10]], [2, ['cue0', 'cue1'], [0, 6]]]) {
    await seed(); await removeLine(index);
    await expect.poll(async () => (await read()).rows[0].cards.map(c => [c.cueRefs, c.sin, c.sout])).toEqual([[refs, ...range]]);
    await expect(page.locator('.dtc')).toHaveText(`${index === 0 ? '00:00:04:00' : '00:00:00:00'} → ${index === 0 ? '00:00:10:00' : '00:00:06:00'}`);
    expect((await read()).media.one.cues).toEqual(cues); expect((await read()).media.two.cues).toEqual(cues);
    await undo(); await expect(page.locator('[data-story-cue]')).toHaveCount(3);
    await expect.poll(async () => (await read()).rows[0].cards[0].sin).toBe(0);
  }
  await seed(); await removeLine(1);
  await expect.poll(async () => (await read()).rows[0].cards.map(c => [c.cueRefs, c.sin, c.sout])).toEqual([[['cue0'], 0, 2], [['cue2'], 8, 10]]);
  await expect(page.locator('.dcard')).toHaveCount(2); await undo(); await expect(page.locator('.dcard')).toHaveCount(1); await expect(page.locator('[data-story-cue]')).toHaveCount(3);
  await seed(); await page.locator('.dbody').fill(''); await page.locator('.dbody').press('Tab');
  await expect.poll(async () => (await read()).rows[0].cards.length).toBe(0); await undo(); await expect(page.locator('[data-story-cue]')).toHaveCount(3);
  await seed(); await page.getByTitle('Edit cues individually').click();
  await page.locator('.mtxt').first().fill(''); await page.locator('.mtxt').first().press('Tab');
  await expect.poll(async () => (await read()).rows[0].cards[0].sin).toBe(4); await undo(); await expect(page.locator('.mtxt')).toHaveCount(3);
  await seed(); await page.locator('.dbody').fill('Bridge sentence.\nClosing sentence.'); await page.locator('.dbody').press('Tab');
  await expect.poll(async () => (await read()).rows[0].cards[0].cueRefs).toEqual(['cue1', 'cue2']);
  await page.reload(); await page.keyboard.press('F4'); await expect(page.locator('[data-story-cue]')).toHaveCount(2);
  fixture.media.one.cues = cues.map((c, i) => i < 2 ? { ...c, textOverride: 'Repeated sentence.' } : c);
  await seed(); await removeLine(0);
  await expect.poll(async () => (await read()).rows[0].cards[0].cueRefs).toEqual(['cue1', 'cue2']);
  await expect.poll(async () => (await read()).rows[0].cards[0].sin).toBe(4);
  fixture.media.one.cues = cues;
  await seed(); await page.locator('.barsel[title="Which subtitle track this view reads and writes"]').selectOption('B'); await removeLine(0);
  await expect.poll(async () => (await read()).rows[0].cards[0].cueRefs).toEqual(['cue1', 'cue2']);
  expect((await read()).media.one.cues).toEqual(cues); expect((await read()).media.one.cuesB).toEqual(fixture.media.one.cuesB);
  await undo(); await expect(page.locator('[data-story-cue]')).toHaveCount(3);
  expect(errors).toEqual([]);
  console.log('Native first/middle/last/all deletion, repeated text, Sub B, card bounds/splitting, mini editor, paste-style replacement, Undo, source isolation and reload passed.');
  fixture.media.one.words = Array.from({ length: 60 }, (_, i) => ({ t: 'word' + i, i, s: i, e: i + .8, sp: 'S1' }));
  const run = async () => {
    await seed(); await page.locator('.asset').filter({ has: page.locator('b', { hasText: /^one$/ }) }).click();
    await page.locator('.drawer-tab button[title="AI Assistant"]').click(); await page.getByLabel('AI preset').selectOption('transcript_check');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
  };
  const start = requests.length;
  answer = items => ({ flags: items[0].id === 25 ? [
    { target: items[0].target, reason: 'Second batch valid', suggestion: 'Corrected' },
    { target: 'r9999', reason: 'Unissued target', suggestion: 'Never apply' },
    { target: items[1].target, suggestion: 'No reason' },
  ] : [{ target: ' ' + items[0].target.toUpperCase() + ' ', explanation: 'Valid other batch', suggestion: 'Corrected' }] });
  await run(); await expect(page.getByText(/Skipped 2 invalid flags/)).toBeVisible();
  expect(requests.slice(start).map(batch => batch.length)).toEqual([25, 25, 10]);
  await expect.poll(async () => (await read()).reviews.map(f => f.id)).toEqual([0, 25, 50]);
  await page.getByLabel('AI review flags').getByRole('button', { name: 'Apply suggestion' }).nth(1).click();
  await expect.poll(async () => (await read()).media.one.words[25].t).toBe('Corrected');
  expect((await read()).media.one.words[26].t).toBe('word26'); expect((await read()).media.two.words).toEqual(words);
  const retryStart = requests.length;
  answer = (items, prompt) => items[0].id === 25 && !prompt.includes('previous response') ? '{"not_flags":[]}' : { flags: [{ target: items[0].target, reason: 'After format repair' }] };
  await run(); await expect(page.getByText('3 flags added. Review them in the editor.')).toBeVisible();
  expect(requests.slice(retryStart).map(batch => batch[0].id)).toEqual([0, 25, 25, 50]);
  const failedStart = requests.length;
  answer = items => items[0].id === 25 ? 'invalid JSON' : { flags: [{ target: items[0].target, reason: 'Remaining batch checked' }] };
  await run(); await expect(page.getByText(/1 batches could not be reviewed/)).toBeVisible();
  expect(requests.slice(failedStart).map(batch => batch[0].id)).toEqual([0, 25, 25, 50]);
  await expect.poll(async () => (await read()).reviews.map(f => f.id)).toEqual([0, 50]);
  expect(errors).toEqual([]);
  console.log('Multi-batch review continues past invalid flags, validates aliases, preserves valid suggestions, repairs format once and skips irreparable batches without losing later results.');
} finally { await browser.close(); }
