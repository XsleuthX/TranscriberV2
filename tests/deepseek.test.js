import test from 'node:test';
import assert from 'node:assert/strict';
import {DEEPSEEK_MODELS,deepSeekPayload,discoveredDeepSeek} from '../src/deepseek-models.js';
import {readDeepSeekStream,deepSeekRequest} from '../server/deepseek.js';
import {aiRequest} from '../src/ai-request.js';
const input={messages:[{role:'user',content:'Return JSON {"flags":[]}.'}],response_format:{type:'json_object'}};
const sse=(finish='stop',done=true)=>': keep-alive\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE reasoning'}}]})+'\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{content:'你好 🌏'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\n\n'+(done?'data: [DONE]\n\n':'');
const streamResponse=text=>{
 const bytes=new TextEncoder().encode(text);
 return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
};
class Output {
 constructor(){this.headers={};this.text='';this.destroyed=false;this.writableEnded=false;}
 setHeader(k,v){this.headers[k]=v;}
 writeHead(status,headers){this.statusCode=status;Object.assign(this.headers,headers);}
 write(text){this.text+=text;}
 end(text=''){this.text+=text;this.writableEnded=true;}
}
test('current model IDs, legacy migration, independent thinking effort and explicit JSON envelope',()=>{
 assert.deepEqual(DEEPSEEK_MODELS.map(m=>m.id),['deepseek-flash','deepseek-v4-pro']);
 for(const model of ['deepseek-flash','deepseek-v4-pro','deepseek-chat','deepseek-reasoner','deepseek-v4-flash']){
   const p=deepSeekPayload(model,input,'low');assert.equal(p.thinking.type,'enabled');assert.equal(p.reasoning_effort,'low');assert.equal(p.response_format.type,'json_object');assert.ok(p.messages[0].content.includes('JSON'));assert.equal(p.stream,true);assert.equal(p.max_tokens,16384);
 }
 const p=deepSeekPayload('deepseek-v4-pro',{messages:input.messages},'off');assert.equal(p.model,'deepseek-v4-pro');assert.equal(p.thinking.type,'disabled');assert.ok(!('response_format'in p));assert.ok(!('reasoning_effort'in p));
 assert.throws(()=>deepSeekPayload('not-a-model',input),/model/);assert.throws(()=>deepSeekPayload('deepseek-flash',input,'invented'),/effort/);
 assert.deepEqual(discoveredDeepSeek({data:[{id:'deepseek-chat'},{id:'deepseek-flash',name:'Current Flash'},{id:'deepseek-next',output_modalities:['text']},{id:'other'}]}).map(m=>m.id),['deepseek-flash','deepseek-next']);
});
test('SSE survives arbitrary UTF-8/event splits, ignores keepalives and never returns reasoning',async()=>{
 const phases=[],data=await readDeepSeekStream(streamResponse(sse()),phase=>phases.push(phase));
 assert.equal(data.choices[0].message.content,'你好 🌏');assert.deepEqual(phases,['Thinking','Generating answer']);assert.ok(!JSON.stringify(data).includes('PRIVATE'));
 await assert.rejects(readDeepSeekStream(streamResponse(sse('stop',false))),/before the answer completed/);
});
test('structured truncation is returned as incomplete for adaptive batching, without a duplicate paid retry',async()=>{
 const out=new Output();let calls=0;
 await deepSeekRequest({headers:{'x-ai-progress':'1'}},out,input,'deepseek-v4-pro','fixture',async()=>{calls++;return streamResponse(sse('length'));},new AbortController().signal);
 const events=out.text.trim().split('\n').map(JSON.parse),result=events.at(-1);assert.equal(calls,1);assert.equal(result.data.incomplete,true);assert.equal(result.status,200);assert.ok(events.some(e=>e.type==='status'));assert.ok(!out.text.includes('PRIVATE'));
});
test('empty final answers, provider errors and unknown finish reasons cannot be applied',async()=>{
 for(const response of [Response.json({choices:[{message:{reasoning_content:'private',content:''},finish_reason:'stop'}]}),Response.json({choices:[{message:{content:'partial'},finish_reason:'insufficient_system_resource'}]}),Response.json({error:{message:'Account balance insufficient'}},{status:402})]){
   const out=new Output();await deepSeekRequest({headers:{'x-ai-progress':'1'}},out,input,'deepseek-flash','fixture',async()=>response,new AbortController().signal);
   const last=JSON.parse(out.text.trim().split('\n').at(-1));assert.ok(last.status>=400);assert.ok(last.data.error.message);assert.ok(!out.text.includes('private'));
 }
});
test('timeout ends a queued request, and cancellation propagates without a late answer',async()=>{
 const hanging=(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 const keepAlive=setTimeout(()=>{},2000);
 try {
 const out=new Output();await deepSeekRequest({headers:{'x-ai-progress':'1'}},out,input,'deepseek-flash','fixture',hanging,new AbortController().signal,20);
 const last=JSON.parse(out.text.trim().split('\n').at(-1));assert.equal(last.status,504);assert.match(last.data.error.message,/request limit/);
 const controller=new AbortController(),cancelled=new Output();const task=deepSeekRequest({headers:{}},cancelled,input,'deepseek-flash','fixture',hanging,controller.signal);controller.abort();await task;assert.equal(cancelled.text,'');
 }finally{clearTimeout(keepAlive);}
});
test('browser transport handles progress, final status, freeform prose and incomplete connections',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const phases=[];
 globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);assert.equal(p.response_format.type,'json_object');assert.equal(options.headers.get('x-ai-thinking'),'low');return new Response('{"type":"status","message":"Thinking"}\n{"type":"result","status":200,"data":{"content":[{"type":"text","text":"Done"}]}}\n',{headers:{'content-type':'application/x-ndjson'}});};
 const response=await aiRequest('/api/ai',{headers:{'x-ai-provider':'deepseek'},body:JSON.stringify(input)},{thinking:'low',onProgress:p=>phases.push(p)});assert.equal((await response.json()).content[0].text,'Done');assert.deepEqual(phases,['Thinking']);
 globalThis.fetch=async(_url,options)=>{assert.ok(!JSON.parse(options.body).response_format);return Response.json({content:[]});};await aiRequest('/api/ai',{headers:{'x-ai-provider':'deepseek'},body:JSON.stringify({messages:input.messages})},{jsonOutput:false});
 globalThis.fetch=async()=>new Response('{"type":"status","message":"Waiting"}\n',{headers:{'content-type':'application/x-ndjson'}});await assert.rejects(aiRequest('/api/ai',{headers:{'x-ai-provider':'deepseek'},body:JSON.stringify(input)}),/before a final response/);
});
