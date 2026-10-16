import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import path from 'node:path';
await fs.mkdir('.test-temp', { recursive: true });
const playback = path.resolve('.test-temp/assembly-playback.mp4');
const encoded = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:r=12:d=120', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=16000:duration=120', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-af', 'volume=0.02', '-movflags', '+faststart', playback], { windowsHide: true });
if (encoded.status !== 0) throw new Error('Playback fixture encoding failed: ' + encoded.stderr);
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/fixture/playback.mp4', async route => route.fulfill({ contentType: 'video/mp4', body: await fs.readFile(playback) }));
  await page.route('**/api/keys', route => route.fulfill({ json: { anthropic: true } }));
  let hold = false, held, truncate = false,malformedOnce=false;
  await page.route('**/api/ai', async route => {
    const prompt = route.request().postDataJSON().messages[0].content;
    const kind = prompt.includes('SOURCE CUES:\n') ? 'cues' : prompt.includes('CANDIDATE QUOTES:\n') ? 'story' : 'freeform';
    const items = kind === 'freeform' ? [] : JSON.parse(prompt.split(kind === 'cues' ? 'SOURCE CUES:\n' : 'CANDIDATE QUOTES:\n')[1].split('\nEditor brief:')[0].split('\nCorrect the previous format:')[0]);
    requests.push({ kind, items });
    if(malformedOnce){malformedOnce=false;return route.fulfill({json:{content:[{type:'text',text:'invalid JSON fixture'}]}});}
    let result = kind === 'cues' ? { clips: [...new Set(items.map(c => c.assetKey))].map(key => {
      const own = items.filter(c => c.assetKey === key); return { from: own[0].id, to: own[Math.min(1, own.length - 1)].id, label: key + ' punchy quote', why: 'Strong opening' };
    }) } : kind === 'story' ? { sections: [{ title: 'Hook', clips: [items.at(-1).id] }, { title: 'Development', clips: [items[0].id] }] } : 'Retained chat output';
    const reply = () => route.fulfill({ json: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] } });
    if (truncate && items.length > 20) return route.fulfill({ json: { incomplete: true, content: [] } });
    if (hold) { held = { reply, items }; return; }
    return reply();
  });
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  const read = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('transcriber', 1); r.onsuccess = () => resolve(r.result); });
    const doc = await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('current'); r.onsuccess = () => resolve(r.result); }); db.close(); return doc;
  });
  await expect.poll(async () => !!(await read())?.mtl).toBe(true);
  const original = await read(), texts = ['A strong opening.', 'An interesting answer.', 'A conclusion.'];
  const cues = texts.map((text, i) => ({ id: 'cue' + i, ws: i, we: i, textOverride: text, startOverride: i * 4, endOverride: i * 4 + 3 }));
  const fixture = { ...original, reviews: [], activeAsset: 'one', ui: { projectName: 'Assembly test', ws: 'transcript', track: 'A', docSize: 17, uiZoom: 1, mtlZoom: 28, mtlSnap: true },
    media: Object.fromEntries(['one', 'two'].map(key => [key, { name: key, type: 'local', url: null, offline: true, duration: 200,
      words: texts.map((t, i) => ({ t, i, s: i * 4, e: i * 4 + 3, sp: 'S1' })), cues,
      cuesB: cues.map(c => ({ ...c, ws: null, we: null, id: c.id + '_B', textOverride: '译文 ' + c.textOverride })),
      pcm: new Int16Array([123, -321, 32767, -32768]).buffer, pcmRate: 16000,
      clips: [{ id: 'old', in: 0, out: 3, label: 'Existing', enabled: true }] }])),
    rows: [{ id: 'original', label: 'Existing section', cards: [{ id: 'original-card', kind: 'cue', col: 'video', assetKey: 'two', cueRefs: ['cue2'], sourceCueRefs: ['cue2'], title: 'Existing story', sin: 8, sout: 11 }] }] };
  const seed = async () => {
    hold = false; held = null;
    await page.evaluate(async doc => {
      for (const asset of Object.values(doc.media)) asset.pcm = new Int16Array([123, -321, 32767, -32768]).buffer;
      const db = await new Promise(resolve => { const r = indexedDB.open('transcriber', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise(resolve => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(doc, 'current'); tx.oncomplete = resolve; }); db.close();
    }, fixture);
    await page.reload(); await expect(page.locator('.asset b').filter({ hasText: /^one$/ })).toBeVisible();
  };
  const preset = async id => {
    if (!await page.getByLabel('AI preset').isVisible()) await page.locator('.drawer-tab button[title="AI Assistant"]').click();
    await page.getByLabel('AI preset').selectOption(id);
  };
  const run = () => page.getByRole('button', { name: 'Run', exact: true }).click();
  const undo = () => page.getByRole('button', { name: /Undo/ }).first().click();
  await seed(); await preset('timeline_get_clips');
  expect(await page.getByLabel('AI preset').locator('option').allTextContents()).toEqual(['Freeform chat', 'Subtitle Check', 'Subtitle Polish', 'Transcript Check', 'Timeline Get Clips', 'Story Suggestion']);
  await run(); await expect(page.getByText(/Added 1 clips to Timeline/)).toBeVisible();
  await expect.poll(async () => (await read()).media.one.clips.length).toBe(2);
  let doc = await read(); expect(doc.media.one.clips[1].cueRefs).toEqual(['cue0', 'cue1']); expect([doc.media.one.clips[1].in, doc.media.one.clips[1].out]).toEqual([0, 7]); expect(doc.media.two.clips.length).toBe(1);
  await undo(); await expect.poll(async () => (await read()).media.one.clips.length).toBe(1);
  await seed(); await preset('timeline_get_clips'); hold = true; await run(); await expect.poll(() => !!held).toBe(true);
  await page.locator('.asset').filter({ has: page.locator('b', { hasText: /^two$/ }) }).click();
  hold = false; await held.reply(); await expect(page.getByText(/Added 1 clips to Timeline/)).toBeVisible();
  await expect.poll(async () => (await read()).media.one.clips.length).toBe(2); expect((await read()).media.two.clips.length).toBe(1);
  await seed(); await preset('story_suggestion'); await run(); await expect(page.getByText(/Added 2 source-linked cards/)).toBeVisible();
  await expect.poll(async () => (await read()).rows.length).toBe(3);
  doc = await read(); expect(doc.rows[0]).toEqual(fixture.rows[0]); expect(doc.rows.slice(1).map(r => r.cards[0].assetKey)).toEqual(['two', 'one']);
  expect(doc.rows[1].cards[0].cueRefs).toEqual(['cue0', 'cue1']); expect(doc.rows[1].cards[0].body).toBe(texts.slice(0, 2).join('\n'));
  await page.reload(); await expect(page.locator('.dcard')).toHaveCount(3); expect((await read()).rows.length).toBe(3);
  // Generated cards remain normal editable, source-linked Story cards.
  const generatedBody=page.locator('.dcard .dbody').nth(1);await generatedBody.focus();
  await generatedBody.locator('[data-story-cue]').first().evaluate(el=>{el.textContent='User edited sample quote.';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));});await generatedBody.press('Tab');
  await expect.poll(async()=>(await read()).media.two.cues[0].textOverride).toBe('User edited sample quote.');
  await seed();await preset('story_suggestion');hold=true;await run();await expect.poll(()=>!!held).toBe(true);
  await page.keyboard.press('F4');const shot=page.locator('.dcard .dsel').first();const secondShot=await shot.locator('option').nth(1).getAttribute('value')||await shot.locator('option').nth(1).textContent();await shot.selectOption(secondShot);
  hold=false;await held.reply();await expect(page.getByText(/Story was edited while AI was running/)).toBeVisible();
  expect((await read()).rows.length).toBe(1);await expect.poll(async()=>(await read()).rows[0].cards[0].label).toBe(secondShot);
  await seed();await preset('story_suggestion');hold=true;await run();await expect.poll(()=>!!held).toBe(true);
  await page.getByRole('button',{name:'Cancel AI',exact:true}).click();await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
  await held.reply().catch(()=>{});expect((await read()).rows).toEqual(fixture.rows);
  await seed();await preset('story_suggestion');malformedOnce=true;await run();await expect(page.getByText(/Added 2 source-linked cards/)).toBeVisible();
  await seed(); await preset('story_suggestion'); await run(); await expect(page.getByText(/Added 2 source-linked cards/)).toBeVisible();
  await undo(); await expect.poll(async () => (await read()).rows.length).toBe(1);
  // A changed source cannot receive stale AI-derived clips.
  await seed(); await preset('timeline_get_clips'); hold = true; await run(); await expect.poll(() => !!held).toBe(true);
  await page.keyboard.press('F2'); await page.locator('.ctext').first().fill('Newer transcript edit.'); await page.locator('.ctext').first().press('Tab');
  hold = false; await held.reply(); await expect(page.getByText(/Source transcripts changed/)).toBeVisible();
  expect((await read()).media.one.clips.length).toBe(1);
  console.log('Clip creation, all-media Story ordering/source linkage, existing work, Undo, reload, source switching and stale protection passed.');
  // Exercise adaptive extraction on a long transcript.
  fixture.media.one.words = Array.from({ length: 45 }, (_, i) => ({ t: 'quote ' + i, s: i * 4, e: i * 4 + 3 }));
  fixture.media.one.cues = fixture.media.one.words.map((w, i) => ({ id: 'long' + i, ws: i, we: i }));
  await seed(); await preset('timeline_get_clips'); truncate = true; const start = requests.length; await run();
  await expect(page.getByText(/Added 3 clips to Timeline/)).toBeVisible();
  expect(requests.slice(start).map(r => r.items.length)).toEqual([40, 20, 20, 5]);
  truncate = false; fixture.media.one.words = fixture.media.two.words; fixture.media.one.cues = cues;
  // Export actual download, import it, and verify binary cache and every assembly.
  await seed(); await preset('story_suggestion'); await run(); await expect(page.getByText(/Added 2 source-linked cards/)).toBeVisible();
  await page.keyboard.press('F5'); await page.locator('.tlwrap').getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(page.getByText('Build your first sequence.')).toBeVisible();
  await page.getByRole('button', { name: 'Compact tracks', exact: true }).click(); await expect(page.getByRole('button', { name: 'Comfortable tracks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Follow playhead', exact: true }).click(); await expect(page.getByRole('button', { name: 'Follow playhead', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.tlwrap').getByRole('button', { name: 'Add media', exact: true }).click(); await expect(page.getByLabel('Timeline source')).toHaveCount(0);
  await page.locator('.tlwrap').getByRole('button', { name: 'Add media', exact: true }).click(); await expect(page.getByLabel('Timeline source')).toHaveValue('one');
  await page.getByRole('button', { name: 'Lock V1', exact: true }).click(); await expect(page.getByRole('button', { name: 'Lock V1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await read()).mtl.tracks.find(t => t.id === 'V1').locked).toBe(true);
  const before = await read();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export Project JSON', exact: true }).click();
  const download = await downloadPromise, json = await fs.readFile(await download.path(), 'utf8'), parsed = JSON.parse(json);
  expect(parsed.project.rows).toEqual(before.rows); expect(parsed.project.media.one.cuesB).toEqual(before.media.one.cuesB); expect(parsed.project.media.one.pcm.encoding).toBe('pcm16-base64');
  // A malformed import leaves the document untouched.
  await page.getByLabel('Import Project JSON file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"invalid":true}') });
  await expect(page.getByText(/Project import failed/)).toBeVisible(); expect((await read()).rows).toEqual(before.rows);
  const reloaded = page.waitForEvent('load');
  await page.getByLabel('Import Project JSON file').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await reloaded;
  await expect(page.getByLabel('Timeline source')).toBeVisible();
  await expect.poll(async () => (await read())?.ui?.projectName).toBe('Assembly test');
  await expect.poll(async () => (await read()).media.one.offline).toBe(true);
  doc = await read(); expect(doc.rows).toEqual(before.rows); expect(doc.mtl).toEqual(before.mtl);
  const samples = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('transcriber', 1); r.onsuccess = () => resolve(r.result); });
    const p = await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('current'); r.onsuccess = () => resolve(r.result); }); db.close(); return Array.from(new Int16Array(p.media.one.pcm));
  });
  expect(samples).toEqual([123, -321, 32767, -32768]); expect(errors).toEqual([]);
  // A populated offline project still exposes its source ranges and cached
  // audio waveform; navigation/inspection does not require original footage.
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('transcriber', 1); r.onsuccess = () => resolve(r.result); });
    const p = await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('current'); r.onsuccess = () => resolve(r.result); });
    p.ui.mtlZoom = 28;
    p.media.one.url = location.origin + '/fixture/playback.mp4'; p.media.one.offline = false;
    p.mtl.clips = [
      { id: 'lower', assetKey: 'one', trackId: 'V1', kind: 'video', groupId: 'linked', title: 'Main interview', color: '#2A6E78', sin: 0, sout: 120, pin: 0, pout: 120 },
      { id: 'sound', assetKey: 'one', trackId: 'A1', kind: 'audio', groupId: 'linked', title: 'Interview audio', color: '#3D5540', sin: 0, sout: 120, pin: 0, pout: 120 },
      { id: 'upper', assetKey: 'two', trackId: 'V2', kind: 'video', title: 'Cutaway', color: '#7A5CB8', sin: 10, sout: 50, pin: 10, pout: 50 },
      { id: 'subtitle', assetKey: 'one', trackId: 'SUB', kind: 'subtitle', title: 'A strong opening.', text: 'A strong opening.', color: '#4A5560', sin: 0, sout: 3, pin: 0, pout: 3 },
    ];
    await new Promise(resolve => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(p, 'current'); tx.oncomplete = resolve; }); db.close();
  });
  await page.reload(); await expect(page.locator('.mtlclip')).toHaveCount(4);
  await expect(page.getByLabel('Cached source audio waveform')).toBeVisible();
  await page.locator('[data-multi-id="upper"]').click(); await expect(page.getByLabel('Opacity', { exact: true })).toBeVisible();
  await page.getByLabel('Opacity', { exact: true }).fill('0.6'); await expect.poll(async () => (await read()).mtl.clips.find(c => c.id === 'upper').opacity).toBe(.6);
  await undo(); await expect.poll(async () => (await read()).mtl.clips.find(c => c.id === 'upper').opacity).toBeUndefined();
  const scrub = page.locator('.viewer .vscrub'), scrubBox = await scrub.boundingBox();
  await scrub.click({ position: { x: scrubBox.width * .85, y: scrubBox.height / 2 } });
  await page.locator('.viewer button[title="Play"]').click();
  await expect.poll(() => page.getByLabel('Multi-Timeline tracks', { exact: true }).evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
  await page.locator('.viewer button[title="Pause"]').click();
  await page.locator('.tlwrap').getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(() => page.getByLabel('Multi-Timeline tracks', { exact: true }).evaluate(el => el.scrollLeft)).toBe(0);
  const fit = await page.getByLabel('Multi-Timeline tracks', { exact: true }).evaluate(el => (el.clientWidth - 180) / 120);
  expect(Number(await page.getByLabel('Timeline zoom', { exact: true }).inputValue())).toBeCloseTo(fit, 1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.test-temp/multi-v232.png' });
  console.log('Adaptive AI batches, File export/import, safe validation, binary audio round-trip, restored settings and Multi-Timeline controls passed.');
} finally { await browser.close(); }
