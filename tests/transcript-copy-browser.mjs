import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/keys',r=>r.fulfill({json:{}}));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedText=text;}}});});
 await page.goto(process.env.APP_URL||'http://localhost:4173');
 await expect(page.getByText('All changes saved')).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('transcriber',1);r.onsuccess=()=>resolve(r.result);});
   const doc=await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);});db.close();return !!doc?.mtl;
 })).toBe(true);
 const words=Array.from({length:16000},(_,i)=>({i,t:i===15999?'FINAL_TRANSCRIPT_TAIL':`word${i}.`,s:i,e:i+.8,sp:'S1'}));
 const expected=words.map(w=>w.t).join(' ');
 await page.evaluate(async words=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('transcriber',1);r.onsuccess=()=>resolve(r.result);});
   const original=await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);});
   await new Promise(resolve=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({...original,activeAsset:'one',media:{one:{name:'Long transcript',type:'local',offline:true,words,cues:[],cuesB:[],clips:[],duration:16000}},rows:[],ui:{...original.ui,ws:'transcript',track:'A'}},'current');tx.oncomplete=resolve;});db.close();
 },words);
 await page.reload();await page.keyboard.press('F1');
 await expect(page.getByRole('button',{name:'Copy transcript',exact:true})).toBeEnabled();
 expect(await page.locator('.line .w').count()).toBeLessThan(words.length);
 await expect(page.getByLabel('Find text')).toHaveCount(0);
 await page.getByRole('button',{name:'Copy transcript',exact:true}).click();
 expect(await page.evaluate(()=>window.copiedText)).toBe(expected);
 await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
 expect(await page.evaluate(()=>window.copiedText)).toBe(expected);
 await page.keyboard.press('Control+f');await expect(page.getByLabel('Find text')).toBeFocused();
 await page.getByLabel('Find text').fill('tail');await page.keyboard.press('Control+a');
 expect(await page.getByLabel('Find text').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe('tail');
 await page.keyboard.press('Escape');await expect(page.getByLabel('Find text')).toHaveCount(0);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Download transcript TXT',exact:true}).click();
 const download=await dl;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
 expect(Buffer.concat(chunks).toString('utf8')).toBe(expected);
 expect(errors).toEqual([]);
 console.log('Transcript copy browser checks passed: full virtualized document, keyboard selection/copy, native field selection, collapsed Find and complete TXT download.');
} finally {await browser.close();}
