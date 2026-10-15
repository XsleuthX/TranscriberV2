import {deepSeekPayload} from '../src/deepseek-models.js';
import {json} from './access.js';

export async function readDeepSeekStream(response,onProgress=()=>{}) {
  if(!response.headers.get('content-type')?.includes('text/event-stream'))return response.json();
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',text='',finish=null,done=false,size=0;
  try {
    while(true){
      const part=await reader.read();pending+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
      const lines=pending.split(/\r?\n/);pending=lines.pop();if(part.done&&pending){lines.push(pending);pending='';}
      for(const line of lines){
        if(!line.startsWith('data:'))continue;
        const raw=line.slice(5).trim();if(!raw)continue;if(raw==='[DONE]'){done=true;continue;}
        const event=JSON.parse(raw);if(event.error)throw new Error(event.error.message||'DeepSeek stream failed.');
        const choice=event.choices?.[0];if(!choice)continue;
        if(choice.delta?.reasoning_content)onProgress('Thinking');
        if(typeof choice.delta?.content==='string'){text+=choice.delta.content;onProgress('Generating answer');}
        size+=line.length;if(size>8*1024*1024)throw new Error('DeepSeek reply exceeded the app response budget. Request a smaller batch.');
        if(choice.finish_reason)finish=choice.finish_reason;
      }
      if(done||part.done)break;
      if(pending.length>8*1024*1024)throw new Error('DeepSeek returned an oversized stream event.');
    }
    if(!done||!finish)throw new Error('DeepSeek connection ended before the answer completed. Retry the request; no partial edits were applied.');
    return {choices:[{message:{content:text},finish_reason:finish}]};
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function deepSeekRequest(req,res,input,model,key,apiFetch,parentSignal,timeoutMs=180000) {
  const signal=AbortSignal.any([parentSignal,AbortSignal.timeout(timeoutMs)]),started=Date.now();
  const progressive=req.headers['x-ai-progress']==='1';let timer,lastPhase='',lastSent=0,streamStarted=false;
  const progress=phase=>{
    if(!progressive||res.destroyed||res.writableEnded)return;
    if(phase===lastPhase&&Date.now()-lastSent<1000)return;
    lastPhase=phase;lastSent=Date.now();
    res.write(JSON.stringify({type:'status',message:`${phase} · ${Math.floor((Date.now()-started)/1000)}s`})+'\n');
  };
  const send=(status,data)=>{
    if(res.destroyed||res.writableEnded)return;
    if(streamStarted)res.end(JSON.stringify({type:'result',status,data})+'\n');else json(res,status,data);
  };
  try {
    const payload=deepSeekPayload(model,input,req.headers['x-ai-thinking']);
    if(progressive){res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'});streamStarted=true;progress('Waiting for DeepSeek');timer=setInterval(()=>progress(lastPhase||'Waiting for DeepSeek'),10000);timer.unref?.();}
    let data;
    for(let attempt=0;attempt<2;attempt++){
      const response=await apiFetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal});
      if(!response.ok){let details;try{details=await response.json();}catch{}const hints={401:'Check your DeepSeek API key.',402:'Your DeepSeek account has insufficient balance.',404:'Refresh the DeepSeek model list and choose an available model.',429:'DeepSeek is rate limiting this account. Try again later.',503:'DeepSeek is busy. Try again later.'};return send(response.status,{error:{message:details?.error?.message||hints[response.status]||`DeepSeek HTTP ${response.status}.`}});}
      data=await readDeepSeekStream(response,progress);
      if(data.error)throw new Error(data.error.message||'DeepSeek request failed.');
      const choice=data.choices?.[0];
      // Structured callers split batches themselves. Avoid duplicate long/billed retries.
      if(choice?.finish_reason!=='length'||input.response_format?.type==='json_object'||payload.thinking.type==='enabled'||attempt||payload.max_tokens>=32768)break;
      payload.max_tokens=Math.min(32768,payload.max_tokens*2);progress('Retrying truncated answer once');
    }
    const choice=data.choices?.[0],text=choice?.message?.content;
    if(choice?.finish_reason==='length')return send(200,{content:typeof text==='string'&&text?[{type:'text',text}]:[],incomplete:true,warning:'DeepSeek reached the request output budget. Partial text was kept. Use a smaller batch, disable thinking, or continue freeform output.'});
    if(choice?.finish_reason!=='stop')throw new Error(`DeepSeek stopped with ${choice?.finish_reason||'an unknown finish reason'}. No edits were applied; try again.`);
    if(typeof text!=='string'||!text.trim())throw new Error('DeepSeek returned no final answer. Disable thinking or request a smaller batch.');
    return send(200,{content:[{type:'text',text}]});
  } catch(error){
    if(parentSignal.aborted)return;
    send(signal.aborted?504:502,{error:{message:signal.aborted?`DeepSeek exceeded the ${Math.round(timeoutMs/1000)} second request limit. Try Flash with thinking off or a smaller batch.`:error.message}});
  } finally {clearInterval(timer);}
}
