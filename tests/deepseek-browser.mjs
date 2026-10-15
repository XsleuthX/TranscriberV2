import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],calls=[];let fail=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/keys',r=>r.fulfill({json:{deepseek:true}}));
 await page.route('**/api/deepseek-models',r=>r.fulfill({json:{models:[{id:'deepseek-flash',label:'Flash from API',note:'discovered'},{id:'deepseek-v4-pro',label:'Pro from API',note:'discovered'},{id:'deepseek-next',label:'Future model',note:'discovered'}]}}));
 await page.route('**/api/ai',r=>{
   const body=r.request().postDataJSON(),headers=r.request().headers();calls.push({body,headers});
   const data=fail?{error:{message:'DeepSeek exceeded the 180 second request limit. Try Flash with thinking off or a smaller batch.'}}:{content:[{type:'text',text:body.response_format?'No flags.':'Complete answer 你好.'}]};
   return r.fulfill({contentType:'application/x-ndjson',body:[{type:'status',message:'Waiting for DeepSeek · 0s'},{type:'status',message:'Generating answer · 2s'},{type:'result',status:fail?504:200,data}].map(x=>JSON.stringify(x)+'\n').join('')});
 });
 await page.goto(process.env.APP_URL||'http://localhost:4173');
 await page.locator('.drawer-tab button[title="AI Assistant"]').click();
 await page.getByLabel('AI provider',{exact:true}).selectOption('deepseek');
 const model=page.getByLabel('AI model',{exact:true}),thinking=page.getByLabel('DeepSeek thinking',{exact:true});
 await expect(model.locator('option')).toHaveCount(2);await expect(thinking).toHaveValue('off');
 for(const [id,effort] of [['deepseek-flash','off'],['deepseek-v4-pro','low'],['deepseek-v4-pro','high'],['deepseek-flash','max']]){
   await model.selectOption(id);await thinking.selectOption(effort);
   await page.getByRole('button',{name:'Run',exact:true}).click();
   await expect(page.getByLabel('AI assistant output')).toHaveValue('Complete answer 你好.');
   await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
   expect(calls.at(-1).headers['x-ai-model']).toBe(id);expect(calls.at(-1).headers['x-ai-thinking']).toBe(effort);expect(calls.at(-1).body.response_format).toBeUndefined();
 }
 await page.getByRole('button',{name:'Refresh DeepSeek models',exact:true}).click();
 await expect(model.locator('option')).toHaveCount(3);await model.selectOption('deepseek-next');
 await page.getByRole('button',{name:'Run',exact:true}).click();await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();expect(calls.at(-1).headers['x-ai-model']).toBe('deepseek-next');
 fail=true;await page.getByRole('button',{name:'Run',exact:true}).click();
 await expect(page.locator('.drawer-body')).toContainText('180 second request limit');await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
 // A queued request remains cancellable; a cancelled result cannot overwrite output.
 let held;await page.route('**/api/ai',r=>{held=r;});
 await page.getByRole('button',{name:'Run',exact:true}).click();await expect.poll(()=>!!held).toBe(true);
 await expect(model).toBeDisabled();await page.getByRole('button',{name:'Cancel AI',exact:true}).click();
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
 await held.fulfill({json:{content:[{type:'text',text:'LATE RESULT'}]}}).catch(()=>{});
 await expect(page.getByLabel('AI assistant output')).toHaveCount(0);
 expect(errors).toEqual([]);console.log('DeepSeek browser checks passed: both current IDs, separate thinking, discovery, NDJSON results/errors, bounded-wait feedback and cancellation.');
}finally{await browser.close();}
