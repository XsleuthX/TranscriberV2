// Run inside the built production image, using only its packaged files/runtime.
import assert from 'node:assert/strict';
const origin=process.env.APP_ORIGIN;
assert.equal(process.env.NODE_ENV,'production');
assert.ok(process.env.APP_PASSWORD?.length>=16);
let ready=false;
for(let attempt=0;attempt<30;attempt++){
  try {const r=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.ok(ready,'Production container did not become healthy.');
const locked=await fetch(origin+'/');assert.match(await locked.text(),/Workspace password/);
const blocked=await fetch(origin+'/api/keys');assert.equal(blocked.status,401);
const login=await fetch(origin+'/auth/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:process.env.APP_PASSWORD})});
assert.equal(login.status,303);
const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie?.startsWith('transcriber_session='));
const headers={Cookie:cookie};
const app=await fetch(origin+'/',{headers});assert.equal(app.status,200);
const html=await app.text(),asset=html.match(/src="([^\"]+\.js)"/);assert.ok(asset,'Built frontend script was not served.');
const bundle=await fetch(new URL(asset[1],origin),{headers});assert.equal(bundle.status,200);assert.match(bundle.headers.get('content-type'),/javascript/);
assert.equal((await fetch(origin+'/src/deepseek-models.js',{headers})).status,404,'Runtime source must not be served as a frontend asset.');
const keys=await fetch(origin+'/api/keys',{headers});assert.equal(keys.status,200);assert.equal((await keys.json()).workspaceProtected,true);
// Exercise provider routes without a key or external API call.
for(const route of ['/api/deepseek-models','/api/ai']){
  const response=await fetch(origin+route,{method:'POST',headers:{...headers,'Content-Type':'application/json','x-ai-provider':'deepseek'},body:JSON.stringify({messages:[{role:'user',content:'Container smoke test'}]})});
  assert.equal(response.status,501);assert.match((await response.json()).error.message,/key/i);
}
console.log('Production container passed: startup, shared module imports, health, authentication, frontend assets and DeepSeek routes.');
