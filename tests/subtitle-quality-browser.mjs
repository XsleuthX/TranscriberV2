import { chromium, expect } from '@playwright/test';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/keys',r=>r.fulfill({json:{openai:true,local:true}}));
  await page.route('**/api/iconik/connect',r=>r.fulfill({json:{connected:true}}));
  await page.route('**/api/iconik/resolve',r=>r.fulfill({json:{assetId:'quality',proxyId:'quality',name:'Quality reference',url:'',audioUrl:'/api/iconik/audio/quality'}}));
  const samples=new Float32Array(12*16000);
  for(let i=3*16000;i<6*16000;i++) samples[i]=Math.sin(i*.1)*.1;
  await page.route('**/api/iconik/audio/*',r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(samples.buffer)}));
  await page.route('**/api/transcribe',r=>{calls.push(r);});
  await page.goto(process.env.APP_URL||'http://localhost:4173');
  await expect(page.getByText('All changes saved')).toBeVisible(); await page.keyboard.press('F2');
  const progress=page.getByRole('progressbar',{name:'Transcription progress'});
  await page.getByRole('button',{name:'Add media',exact:true}).click();
  await page.getByRole('button',{name:'Iconik',exact:true}).click();
  await page.getByLabel('Iconik asset link').fill('https://app.iconik.io/asset/quality/');
  await page.getByRole('button',{name:'Import / reconnect asset',exact:true}).click();
  await expect(page.getByText(/Imported Quality reference/)).toBeVisible();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('.drawer-tab button[title="Transcribe"]').click();
  await page.locator('select').filter({has:page.locator('option[value="multi"]')}).selectOption('zh');
  await expect(page.getByRole('status',{name:'Media audio preparation'})).toHaveCount(0);
  await expect(progress).toHaveCount(0); expect(calls.length).toBe(0);
  const start=page.getByRole('button',{name:/Transcribe.*Sub A/,exact:true});
  const read=()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('transcriber',1);r.onsuccess=()=>resolve(r.result);});
    const value=await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);});db.close();return value;
  });
  const asset=async()=>(await read())?.media?.iconik_quality || {cues:[],cuesB:[]};
  const main={segments:[{start:0,end:1,text:'开头',avg_logprob:-.1},{start:9,end:10,text:'结尾',avg_logprob:-.1}],
    words:[{start:0,end:1,word:'开头'},{start:9,end:10,word:'结尾'}]};
  await start.click(); await expect.poll(()=>calls.length).toBe(1);
  await calls[0].fulfill({json:main}); await expect.poll(()=>calls.length).toBe(2);
  // A nonempty low-confidence result must not stop the bounded retry ladder.
  await calls[1].fulfill({json:{segments:[{start:.3,end:3.3,text:'错误候选',avg_logprob:-1.4}],words:[]}});
  await expect.poll(()=>calls.length).toBe(3);
  await calls[2].fulfill({json:{segments:[{start:.3,end:3.3,text:'中间的内容',avg_logprob:-.2,no_speech_prob:.02}],words:[{start:.3,end:3.3,word:'中间的内容'}]}});
  await expect(progress).toHaveCount(0);
  await expect.poll(async()=>(await asset()).cues.map(c=>c.textOverride)).toEqual(['开头','中间的内容','结尾']);
  const recovered=await asset();
  expect(recovered.transcriptionSource.repaired).toBe(1); expect(recovered.transcriptionSource.unresolved).toBe(0);
  expect(recovered.transcriptionSource.segments.some(s=>s.text==='错误候选')).toBe(false);
  expect(recovered.cues[1].confidence.logprob).toBe(-.2);
  await expect(page.locator('.badge[title*="recovered automatically"]')).toBeVisible();
  expect(calls[2].request().headers()['x-language']).toBe('auto');
  const savedB=JSON.stringify(recovered.cuesB);
  // New edits cannot be overwritten by an in-flight result.
  await start.click(); await expect.poll(()=>calls.length).toBe(4);
  await page.locator('.ctext').first().fill('用户的新编辑');
  await calls[3].fulfill({json:{segments:[{start:0,end:12,text:'过时输出'}],words:[{start:0,end:12,word:'过时输出'}]}});
  await expect(progress).toHaveCount(0);
  await expect(page.getByText(/Your edits were kept/)).toBeVisible();
  await expect.poll(async()=>(await asset()).cues[0].textOverride).toBe('用户的新编辑');
  expect(JSON.stringify((await asset()).cuesB)).toBe(savedB);
  await page.getByRole('button',{name:/Undo/}).first().click();
  await expect.poll(async()=>(await asset()).cues[0].textOverride).toBe('开头');
  // Mismatched words preserve segment text and surface estimated split timing.
  await start.click(); await expect.poll(()=>calls.length).toBe(5);
  const original='所以就用这个词,Dr. Lotus,所以有时候你以为是博士,其实不是博士。到底是荷花还是睡莲？';
  await calls[4].fulfill({json:{segments:[{start:0,end:12,text:original}],words:[{start:0,end:12,word:'不匹配的词'}]}});
  await expect(progress).toHaveCount(0);
  await expect.poll(async()=>(await asset()).cues.map(c=>c.textOverride).join('')).toBe(original);
  await expect(page.locator('.badge').filter({hasText:'estimated timing'}).first()).toBeVisible();
  const final=await asset(); expect(final.cues.every(c=>c.timingEstimated)).toBe(true);
  expect(final.words.map(w=>w.t).join('').replace(/\s/g,'')).toBe(original.replace(/\s/g,''));
  expect(final.words.every(w=>w.timingEstimated)).toBe(true);
  expect(JSON.stringify(final.cuesB)).toBe(savedB);
  await page.getByRole('button',{name:/Undo/}).first().click();
  await expect.poll(async()=>(await asset()).cues.map(c=>c.textOverride)).toEqual(['开头','中间的内容','结尾']);
  // The user's glossary must survive reload instead of reverting to demo replacements.
  await page.getByRole('button',{name:'Dictionary · 0 terms',exact:true}).click();
  await page.getByRole('button',{name:'Add row',exact:true}).click();
  await page.locator('.dictrow input').nth(0).fill('Dr Lotus');
  await page.locator('.dictrow input').nth(1).fill('Dr. Lotus');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Priming on',exact:true}).click();
  await expect.poll(async()=>(await read())?.ui?.dictionary?.asr).toEqual([{from:'Dr Lotus',to:'Dr. Lotus'}]);
  await expect.poll(async()=>(await read())?.ui?.priming).toBe(false);
  await page.reload(); await page.keyboard.press('F2');
  await page.locator('.drawer-tab button[title="Transcribe"]').click();
  await expect(page.getByRole('button',{name:'Dictionary · 1 terms',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Priming off',exact:true})).toBeVisible();
  await expect(progress).toHaveCount(0); expect(calls.length).toBe(5);
  // Browser-local inference shares the quality pipeline; missing word ends
  // remain estimates instead of masquerading as verified timestamps.
  await page.evaluate(()=>{
    window.Worker=class extends EventTarget {
      postMessage(request) {queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{type:'result',id:request.id,
        out:{chunks:[{text:'你好',timestamp:[0,4]},{text:'世界',timestamp:[4,null]}]}}})));}
      terminate() {}
    };
  });
  await page.getByRole('button',{name:'Local',exact:true}).click();
  await start.click();
  await expect.poll(async()=>(await asset()).words.map(w=>w.t).join('')).toBe('你好世界');
  await expect(progress).toHaveCount(0); expect(calls.length).toBe(5);
  const local=await asset(); expect(local.timingEstimated).toBe(true);
  expect(local.transcriptionModel).toBe('Xenova/whisper-base');
  expect(local.cues[0].confidence.logprob).toBe(null);
  expect(errors).toEqual([]);
  console.log('Subtitle quality browser checks passed: idle progress, audio-only repair candidates, low-confidence retry, retained metadata/review badges, unchanged Sub B, stale edit protection, exact text with estimated splits, Undo, dictionary/priming persistence, and local-worker unknown timing/confidence.');
} finally {await browser.close();}
