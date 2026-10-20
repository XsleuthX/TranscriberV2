import {chromium,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import ffmpeg from 'ffmpeg-static';
const dir=await mkdtemp(path.join(tmpdir(),'story-range-'));let browser;
try {
 const result=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:d=12','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(dir,'source.mp4')],{windowsHide:true});if(result.status!==0)throw Error(result.stderr.toString());
 const bytes=await readFile(path.join(dir,'source.mp4'));
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/keys',r=>r.fulfill({json:{}}));
 await page.route('**/range-source.mp4',route=>{const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;return route.fulfill({status:206,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});}return route.fulfill({contentType:'video/mp4',body:bytes});});
 await page.goto(process.env.APP_URL||'http://localhost:4173');
 const read=()=>page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('transcriber',1);q.onsuccess=()=>r(q.result);});const value=await new Promise(r=>{const q=db.transaction('projects').objectStore('projects').get('current');q.onsuccess=()=>r(q.result);});db.close();return value;});
 await expect.poll(async()=>!!(await read())?.mtl).toBe(true);const base=await read();
 const words=['Opening sentence.','Bridge sentence.','Closing sentence.'].map((t,i)=>({i,t,s:i*4,e:i*4+2,sp:'S1'}));
 const cues=words.map((w,i)=>({id:'c'+i,ws:i,we:i,textOverride:w.t,startOverride:w.s,endOverride:w.e}));
 const source={name:'Source One',type:'local',url:'/range-source.mp4',duration:12,words,cues,cuesB:[],clips:[]};
 const fixture={...base,media:{one:source,two:{...source,name:'Source Two'}},activeAsset:'two',rows:[{id:'r',label:'Story',cards:[{id:'card',kind:'cue',col:'video',label:'Studio',assetKey:'one',cueRefs:['c0','c1','c2'],sourceCueRefs:['c0','c1','c2'],sin:0,sout:10,body:'',notes:''}]}],ui:{...base.ui,ws:'story',track:'A'}};
 const seed=async doc=>{await page.evaluate(async value=>{const db=await new Promise(r=>{const q=indexedDB.open('transcriber',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(value,'current');tx.oncomplete=r;});db.close();},doc);await page.reload();await page.keyboard.press('F4');};
 fixture.rows[0].cards.push({id:'audio',kind:'audio',col:'audio',label:'VO',assetKey:'one',cueRefs:[],sourceCueRefs:[],sin:2.12,sout:3.28,rangeMode:'manual',body:'VO copy',bodyManual:true,notes:''});
 await seed(fixture);
 const button=page.locator('[data-card-tc=card]'),pop=page.getByRole('dialog',{name:'Story timecode',exact:true}),float=page.getByRole('dialog',{name:'Cues in story range',exact:true});
 const card=()=>read().then(d=>d.rows[0].cards[0]);
 const open=async()=>{await button.click();await expect(pop).toBeVisible();await expect(float).toBeVisible();};
 const save=async(a,b)=>{await pop.getByLabel('Story In timecode').fill(a);await pop.getByLabel('Story Out timecode').fill(b);await pop.getByRole('button',{name:/^Save/}).click();await expect(pop).toHaveCount(0);};
 const box=await button.boundingBox();await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await expect(pop).toHaveCount(0);await page.mouse.up();await expect(pop).toBeVisible();await expect(float).toBeVisible();
 await expect(page.locator('.vhead')).toHaveText('Source One');
 await page.screenshot({path:'.test-temp/story-range.png'});
 await save('00:00:01:03','00:00:09:07');
 await expect.poll(async()=>[(await card()).sin,(await card()).sout,(await card()).rangeMode]).toEqual([1.12,9.28,'manual']);
 await expect(button).toHaveText('00:00:01:03 → 00:00:09:07');
 await open();await expect(pop.getByLabel('Story In timecode')).toHaveValue('00:00:01:03');await expect.poll(()=>page.locator('.viewer video').evaluate(v=>v.currentTime)).toBeCloseTo(1.12,2);
 await pop.getByLabel('Story Out timecode').fill('00:00:09:25');await expect(pop.getByRole('button',{name:/^Save/})).toBeDisabled();await pop.getByLabel('Story Out timecode').fill('00:00:09:07');
 await pop.locator('label').first().getByRole('button',{name:'+',exact:true}).click();await expect(pop.getByLabel('Story In timecode')).toHaveValue('00:00:01:04');
 await pop.getByRole('button',{name:'Cancel',exact:true}).click();await expect(button).toHaveText('00:00:01:03 → 00:00:09:07');
 await open();const header=await float.locator('.tcfloat-h').boundingBox();await page.mouse.move(header.x+50,header.y+10);await page.mouse.down();await page.mouse.move(header.x-100,header.y+90);await page.mouse.up();await expect(pop).toBeVisible();
 await page.keyboard.press('Escape');await expect(pop).toHaveCount(0);
 await open();await page.locator('.docttl').click();await expect(pop).toHaveCount(0);
 // Text edits must never overwrite the explicit In/Out.
 const body=page.locator('[data-card-id=card] .dbody');await body.focus();await body.evaluate(el=>{el.querySelector('[data-story-cue=c0]').textContent='Opening revised.';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));});await body.press('Tab');
 await expect.poll(async()=>(await read()).media.one.cues[0].textOverride).toBe('Opening revised.');await expect.poll(async()=>[(await card()).sin,(await card()).sout]).toEqual([1.12,9.28]);
 await page.reload();await page.keyboard.press('F4');await expect(button).toHaveText('00:00:01:03 → 00:00:09:07');
 await open();await save('00:00:02:08','00:00:03:15');await expect.poll(async()=>(await card()).cueRefs).toEqual([]);await expect(body).toContainText('Opening revised.');
 await page.getByRole('button',{name:/Undo/}).first().click();await expect(button).toHaveText('00:00:01:03 → 00:00:09:07');
 await open();await pop.getByRole('button',{name:'Use cue timing',exact:true}).click();await expect(button).toHaveText('00:00:00:00 → 00:00:10:00');
 await page.getByRole('button',{name:/Undo/}).first().click();await expect(button).toHaveText('00:00:01:03 → 00:00:09:07');
 // Export uses the exact range, including clipped subtitle boundaries.
 await page.getByRole('button',{name:'Push to Multi-Timeline',exact:true}).first().click();
 await expect.poll(async()=>(await read()).mtl.clips.find(c=>c.kind==='video')?.sin).toBe(1.12);
 let doc=await read(),video=doc.mtl.clips.find(c=>c.kind==='video'),subs=doc.mtl.clips.filter(c=>c.kind==='subtitle');expect(video.sout).toBe(9.28);expect(video.pout-video.pin).toBeCloseTo(8.16,6);expect(subs[0].sin).toBe(1.12);expect(subs.at(-1).sout).toBe(9.28);
 const audio=doc.mtl.clips.find(c=>c.trackId==='A3');expect([audio.sin,audio.sout]).toEqual([2.12,3.28]);expect(audio.pout-audio.pin).toBeCloseTo(1.16,6);
 await page.keyboard.press('F4');await open();await save('00:00:01:03','00:00:01:05');await page.getByRole('button',{name:'Push to Multi-Timeline',exact:true}).first().click();
 await expect.poll(async()=>{const c=(await read()).mtl.clips.find(c=>c.kind==='video');return c.pout-c.pin;}).toBeCloseTo(.08,6);
 for(const zoom of [.8,1.25]){await seed({...fixture,ui:{...fixture.ui,track:'B',uiZoom:zoom}});await open();await expect(float.locator('.tcfloat-r')).toHaveCount(3);const panel=await pop.boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(1601);await page.keyboard.press('Escape');}
 await seed({...fixture,media:{...fixture.media,one:{...fixture.media.one,startTc:'01:00:00:00'}}});
 await open();await page.keyboard.press('Escape');await page.locator('.drawer-tab button[title="Preferences"]').click();await page.getByRole('button',{name:'Use source TC',exact:true}).click();await page.locator('.drawer-tab button[title="Preferences"]').click();
 await expect(button).toHaveText('01:00:00:00 → 01:00:10:00');await open();await save('01:00:01:03','01:00:09:07');await expect(button).toHaveText('01:00:01:03 → 01:00:09:07');await expect.poll(async()=>(await card()).sin).toBeCloseTo(1.12,6);
 expect(errors).toEqual([]);console.log('Story mouse down/up, outside/Escape/drag dismissal, exact ranges, source preview, frame validation/nudge, text edits/reload/Undo/reset, subtitle trimming, Multi-Timeline, UI zoom and source timecode passed.');
} finally {await browser?.close();await rm(dir,{recursive:true,force:true});}
