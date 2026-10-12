import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/keys', route => route.fulfill({ json: { anthropic: true, openai: true } }));
  let answer = items => ({ flags: [{ target: items[0].target, reason: 'Check this wording.', suggestion: items[0].kind === 'cue' ? 'Corrected translation.' : items[0].kind === 'word' ? 'Corrected' : undefined }] });
  let hold = false, held;
  await page.route('**/api/ai', route => {
    const body = route.request().postDataJSON(), prompt = body.messages[0].content;
    if (!prompt.includes('PROJECT ITEMS:\n')) return route.fulfill({ json: { content: [{ type: 'text', text: 'Freeform output retained.' }] } });
    const items = JSON.parse(prompt.split('PROJECT ITEMS:\n')[1]); requests.push(items);
    if (hold) { held = { route, items }; return; }
    if (answer(items).__incomplete) return route.fulfill({ json: { incomplete: true, content: [{ type: 'text', text: '{"flags":[' }] } });
    return route.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify(answer(items)) }] } });
  });
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  await expect(page.getByText('All changes saved')).toBeVisible();
  const read = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('transcriber', 1); req.onsuccess = () => resolve(req.result); });
    const doc = await new Promise(resolve => { const req = db.transaction('projects').objectStore('projects').get('current'); req.onsuccess = () => resolve(req.result); }); db.close(); return doc;
  });
  await expect.poll(async () => !!(await read())?.mtl).toBe(true);
  const original = await read();
  const words = ['original', 'spoken', 'text'].map((t, i) => ({ t, i, s: i, e: i + .8, sp: 'S1' }));
  const fixture = { ...original, reviews: [], activeAsset: 'one', media: Object.fromEntries(['one', 'two'].map(key => [key, {
    name: key, type: 'local', url: null, duration: 12, words,
    cues: [{ id: 'A', ws: 0, we: 2, textOverride: 'Alpha edited text', startOverride: 0, endOverride: 6 }],
    cuesB: [{ id: 'B', ws: null, we: null, textOverride: 'Bonjour monde traduit', startOverride: 0, endOverride: 6 }],
    clips: [{ id: 'clip', in: 0, out: 6, label: 'Interview', color: '#385565' }],
  }])), rows: [{ id: 'row', label: 'Story section', cards: ['one', 'two'].map((key, i) => ({ id: 'card' + i, assetKey: key, kind: 'cue', col: 'video', label: 'Interview', cueRefs: ['A'], sourceCueRefs: ['A'], sin: 0, sout: 6 })) }] };
  const videoTrack = fixture.mtl.tracks.find(t => t.kind === 'video');
  fixture.mtl.clips = [{ id: 'multi', trackId: videoTrack.id, kind: 'video', assetKey: 'two', sin: 0, sout: 6, pin: 1, pout: 7, title: 'Second source', color: '#385565' }];
  const seed = async () => {
    await page.evaluate(async doc => {
      const db = await new Promise(resolve => { const req = indexedDB.open('transcriber', 1); req.onsuccess = () => resolve(req.result); });
      await new Promise(resolve => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(doc, 'current'); tx.oncomplete = resolve; }); db.close();
    }, fixture);
    await page.reload(); await expect(page.locator('.asset b').filter({ hasText: /^one$/ })).toBeVisible(); await page.keyboard.press('F2');
  };
  const track = page.locator('.barsel[title="Which subtitle track this view reads and writes"]');
  const undo = () => page.getByRole('button', { name: /Undo/ }).first().click();
  const redo = () => page.getByRole('button', { name: /Redo/ }).first().click();
  const caret = async (editor, offset) => {
    await editor.focus(); await editor.evaluate((el, at) => { const r = document.createRange(); r.setStart(el.firstChild, at); r.collapse(true); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(r); }, offset);
  };
  for (const mode of ['A', 'B', 'DUAL']) {
    for (const column of mode === 'DUAL' ? ['A', 'B'] : [mode]) {
      await seed(); await track.selectOption(mode);
      const editor = mode === 'DUAL' ? page.locator(`[data-sub-track="${column}"] .ctext`).first() : page.locator('.ctext').first();
      const text = column === 'A' ? 'Alpha edited text' : 'Bonjour monde traduit';
      await caret(editor, 6); await page.keyboard.press('Enter');
      const key = column === 'B' ? 'cuesB' : 'cues', other = column === 'B' ? 'cues' : 'cuesB';
      await expect.poll(async () => (await read()).media.one[key].map(c => c.textOverride)).toEqual([text.slice(0, 6), text.slice(6)]);
      expect((await read()).media.one[other]).toEqual(fixture.media.one[other]);
      if (column === 'A') expect((await read()).rows[0].cards[0].cueRefs.length).toBe(2);
      expect((await read()).rows[0].cards[1].cueRefs).toEqual(['A']);
      await undo(); await expect(page.locator(mode === 'DUAL' ? `[data-sub-track="${column}"] .ctext` : '.ctext')).toHaveText([text]);
      await redo(); await expect.poll(async () => (await read()).media.one[key].length).toBe(2);
    }
  }
  await seed(); await track.selectOption('DUAL'); let editor = page.locator('[data-sub-track="B"] .ctext').first();
  await caret(editor, 8); await page.getByTitle('Split at caret (Enter)', { exact: true }).click();
  await expect.poll(async () => (await read()).media.one.cuesB.map(c => c.textOverride)).toEqual(['Bonjour ', 'monde traduit']);
  await undo(); await caret(page.locator('[data-sub-track="B"] .ctext').first(), 8);
  await page.locator('[data-sub-track="B"] .ctext').first().evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true })));
  await expect.poll(async () => (await read()).media.one.cuesB.length).toBe(2);
  await seed(); editor = page.locator('.ctext').first();
  await editor.focus(); await editor.evaluate(el => {
    el.innerHTML = 'Alpha<div>edited text</div>'; const selection = window.getSelection(), range = document.createRange();
    range.setStart(el.lastChild.firstChild, 7); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await read()).media.one.cues.map(c => c.textOverride)).toEqual(['Alpha\nedited ', 'text']);
  console.log('A/B single/Dual Enter, toolbar caret, mobile beforeinput, multiline text and split Undo/Redo passed.');
  await seed(); editor = page.locator('.ctext').first();
  for (const text of ['First edit', 'Second edit']) { await editor.fill(text); await editor.press('Tab'); }
  await undo(); await expect(editor).toHaveText('First edit'); await undo(); await expect(editor).toHaveText('Alpha edited text');
  await redo(); await expect(editor).toHaveText('First edit'); await editor.fill('New edit'); await editor.press('Tab');
  await redo(); await expect(editor).toHaveText('New edit');
  await page.keyboard.press('F5');
  const clip = page.locator('[data-multi-id="multi"]'), box = await clip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).mtl.clips[0].pin).not.toBe(1);
  await page.keyboard.press('F2'); await undo(); await expect.poll(async () => (await read()).mtl.clips[0].pin).toBe(1);
  await undo(); await expect(page.locator('.ctext').first()).toHaveText('First edit');
  console.log('Rapid independent edits, DOM restoration, Redo invalidation, drag grouping and cross-mode Undo passed.');
  const openAI = async () => { if (!await page.getByLabel('AI preset').isVisible()) await page.locator('.drawer-tab button[title="AI Assistant"]').click(); };
  const preset = async id => { await openAI(); await page.getByLabel('AI preset').selectOption(id); };
  const run = () => page.getByRole('button', { name: 'Run', exact: true }).click();
  await seed(); await preset('subtitle_check');
  await page.locator('.drawer select').filter({ has: page.locator('option[value="BOTH"]') }).selectOption('B'); await run();
  await expect(page.getByLabel('AI review flags')).toContainText('Check this wording.');
  await page.getByRole('button', { name: 'Show flag', exact: true }).click();
  await expect(track).toHaveValue('B'); await page.getByRole('button', { name: 'AI flags: 1' }).click();
  await expect(page.getByRole('dialog', { name: 'AI review hint' })).toContainText('Check this wording.');
  await page.screenshot({ path: '.test-temp/review-v230.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Apply suggestion' }).click();
  await expect.poll(async () => (await read()).media.one.cuesB[0].textOverride).toBe('Corrected translation.');
  expect((await read()).media.one.cues[0].textOverride).toBe('Alpha edited text');
  await undo(); await expect.poll(async () => (await read()).media.one.cuesB[0].textOverride).toBe('Bonjour monde traduit');
  await expect(page.getByLabel('AI review flags')).toContainText('Check this wording.');
  await page.locator('.ctext').first().fill('Manual newer edit'); await page.locator('.ctext').first().press('Tab');
  await expect(page.getByLabel('AI review flags').getByRole('button', { name: 'Apply suggestion' })).toBeDisabled();
  await expect.poll(async () => (await read()).media.one.cuesB[0].textOverride).toBe('Manual newer edit');
  await page.reload(); await openAI(); await expect(page.getByLabel('AI review flags')).toContainText('Content changed');
  console.log('Anchored Sub B floating hints, apply/Undo, stale protection and persisted review flags passed.');
  await seed(); await preset('transcript_check'); await run(); await page.getByRole('button', { name: 'Show flag', exact: true }).click();
  await expect(page.locator('.line .ai-flag')).toBeVisible();
  await page.getByLabel('AI review flags').getByRole('button', { name: 'Apply suggestion' }).click();
  await expect.poll(async () => (await read()).media.one.words[0].t).toBe('Corrected');
  expect((await read()).media.one.words[0].s).toBe(0); await undo();
  const regularCues = fixture.media.one.cues;
  fixture.media.one.cues = Array.from({ length: 26 }, (_, i) => ({ ...regularCues[0], id: 'long' + i, textOverride: 'Subtitle ' + i, startOverride: i, endOverride: i + .8 }));
  await seed(); await preset('subtitle_check'); const beforeBatch = requests.length;
  answer = items => items.length === 25 ? { __incomplete: true } : { flags: [{ target: items[0].target, reason: 'Batched review', suggestion: 'Reviewed text' }] };
  await run(); await expect(page.getByLabel('AI review flags')).toContainText('Batched review');
  expect(requests.slice(beforeBatch).map(items => items.length)).toEqual([25, 13, 12, 1]);
  await expect.poll(async () => (await read()).reviews.length).toBe(3);
  fixture.media.one.cues = regularCues;
  await seed(); await preset('subtitle_check'); hold = true; held = null; await run();
  await expect.poll(() => !!held).toBe(true);
  await page.locator('.asset').filter({ has: page.locator('b', { hasText: /^two$/ }) }).click();
  hold = false; await held.route.fulfill({ json: { content: [{ type: 'text', text: JSON.stringify({ flags: [{ target: held.items[0].target, reason: 'Original source only', suggestion: 'One source corrected' }] }) }] } });
  await expect(page.getByLabel('AI review flags')).toContainText('Original source only');
  await page.getByLabel('AI review flags').getByRole('button', { name: 'Apply suggestion' }).click();
  await expect.poll(async () => (await read()).media.one.cues[0].textOverride).toBe('One source corrected');
  expect((await read()).media.two.cues[0].textOverride).toBe('Alpha edited text');
  console.log('Adaptive truncated-review batching and in-flight source switching passed.');
  await seed(); await preset('freeform'); await page.getByPlaceholder('Focus, output format, or a question to answer.').fill('Summarize this transcript.'); await run();
  await expect(page.getByLabel('AI assistant output')).toHaveValue('Freeform output retained.');
  await preset('subtitle_check'); answer = () => ({ flags: [] }); await run(); await expect(page.getByText('0 flags added. Review them in the editor.')).toBeVisible();
  await preset('freeform'); await expect(page.getByLabel('AI assistant output')).toHaveValue('Freeform output retained.');
  await seed(); await preset('subtitle_polish'); answer = () => ({ flags: [{ target: 'invented', reason: 'invalid' }] }); await run();
  await expect(page.getByText(/unknown target/)).toBeVisible(); expect((await read()).reviews).toEqual([]);
  expect(errors).toEqual([]);
  console.log('Transcript/subtitle corrections, active source scope, adaptive batches, freeform output and invalid response rejection passed.');
} finally { await browser.close(); }
