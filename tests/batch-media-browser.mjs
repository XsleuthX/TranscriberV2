import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
try {
 const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[],prepared=new Set(),calls=[];
 let serial=0,peak=0,live=new Set(),hold=false,held;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/keys',r=>r.fulfill({json:{openai:true}}));
 await page.route('**/api/media/**',async r=>{
   const u=new URL(r.request().url()),route=u.pathname.split('/').at(-1),id=u.searchParams.get('id');
   if(route==='start'){const next='upload'+(++serial);live.add(next);peak=Math.max(peak,live.size);return r.fulfill({status:201,json:{id:next}});}
   if(route==='status')return r.fulfill({json:{state:'ready'}});
   if(route==='audio'){prepared.add(id);return r.fulfill({contentType:'application/octet-stream',body:Buffer.from(new Float32Array(16000).fill(.05).buffer)});}
   if(route==='delete')live.delete(id);
   return r.fulfill({json:{ok:true}});
 });
 await page.route('**/api/transcribe',async r=>{
   const name=decodeURIComponent(r.request().headers()['x-filename']||'');calls.push(name);
   const text='Complete source transcript.';
   const reply=()=>r.fulfill({json:{text,words:text.split(' ').map((word,i)=>({word,start:i*.3,end:(i+1)*.3})),segments:[{text,start:0,end:.9,avg_logprob:-.1,no_speech_prob:0}]}});
   if(hold){held={r,reply};return;}
   if(name.includes('batch-03'))return r.fulfill({status:502,json:{error:{message:'Fixture provider error'}}});
   return reply();
 });
 await page.goto(process.env.APP_URL||'http://localhost:4173');
 const read=()=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('transcriber',1);r.onsuccess=()=>resolve(r.result);});const doc=await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);});db.close();return doc;});
 await expect.poll(async()=>!!(await read())?.mtl).toBe(true);
 await page.getByRole('button',{name:'Add media',exact:true}).click();
 await page.locator('input[type="file"][multiple]').first().setInputFiles(Array.from({length:14},(_,i)=>({name:`batch-${String(i).padStart(2,'0')}.mp4`,mimeType:'video/mp4',buffer:Buffer.from('force server audio fallback '+i)})));
 await expect.poll(()=>prepared.size,{timeout:30000}).toBe(14);expect(peak).toBe(1);
 await expect.poll(async()=>Object.values((await read()).media).filter(m=>m.name.startsWith('batch-')).length).toBe(14);
 await expect(page.getByText('Audio ready',{exact:true})).toHaveCount(14);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('.drawer-tab button[title="Transcribe"]').click();
 await page.getByRole('button',{name:'OpenAI',exact:true}).click();
 const panel=page.getByLabel('Batch transcription',{exact:true});await panel.locator('summary').click();
 await panel.getByRole('button',{name:'Start batch transcription',exact:true}).click();
 const results=page.getByLabel('Batch transcription results',{exact:true});
 await expect.poll(async()=>await results.locator('p').filter({hasText:': completed'}).count(),{timeout:30000}).toBe(13);
 await expect(results).toContainText('batch-03.mp4: failed');expect(calls.length).toBe(14);
 await expect.poll(async()=>Object.values((await read()).media).filter(m=>m.name.startsWith('batch-')&&!m.name.includes('03')&&m.cues.length>0).length).toBe(13);
 let doc=await read();
 // Existing transcripts are excluded unless replacement is explicitly enabled.
 await expect(panel.getByLabel('Batch source batch-00.mp4',{exact:true})).toBeDisabled();
 await panel.getByLabel('Replace existing transcripts in batch').check();await panel.getByRole('button',{name:'Clear selection',exact:true}).click();
 for(const name of ['batch-00.mp4','batch-01.mp4'])await panel.getByLabel('Batch source '+name,{exact:true}).check();
 const before=Object.fromEntries(Object.entries(doc.media).map(([k,m])=>[k,JSON.stringify(m.cues)])),count=calls.length;
 hold=true;await panel.getByRole('button',{name:'Start batch transcription',exact:true}).click();await expect.poll(()=>!!held).toBe(true);
 await panel.getByRole('button',{name:'Cancel batch transcription',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Start batch transcription',exact:true})).toBeEnabled();
 await held.reply().catch(()=>{});expect(calls.length).toBe(count+1);
 doc=await read();for(const [k,m]of Object.entries(doc.media))expect(JSON.stringify(m.cues)).toBe(before[k]);
 expect(errors).toEqual([]);console.log('Batch browser checks passed: 14 real file-picker imports, serialized fallback preparation, full transcription queue, failure continuation, overwrite opt-in and cancellation preserving existing cues.');
}finally{await browser.close();}
