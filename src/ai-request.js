export async function aiRequest(url,options,{thinking='off',onProgress=()=>{},jsonOutput=true,timeoutMs=200000}={}) {
  const headers=new Headers(options.headers),body=JSON.parse(options.body),deepseek=headers.get('x-ai-provider')==='deepseek';
  if(deepseek){headers.set('x-ai-progress','1');headers.set('x-ai-thinking',thinking);if(jsonOutput)body.response_format={type:'json_object'};}
  const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(timeoutMs)]);
  try {
    const response=await fetch(url,{...options,headers,body:JSON.stringify(body),signal});
    if(!response.headers.get('content-type')?.includes('application/x-ndjson'))return response;
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    try {
      while(true){const part=await reader.read();pending+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});const lines=pending.split('\n');pending=lines.pop();if(part.done&&pending){lines.push(pending);pending='';}
        for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);if(event.type==='status')onProgress(event.message);if(event.type==='result')return new Response(JSON.stringify(event.data),{status:event.status,headers:{'Content-Type':'application/json'}});}
        if(part.done)throw new Error('AI connection ended before a final response. Retry the request.');
      }
    } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  } catch(error){if(signal.aborted&&!options.signal?.aborted)throw new Error('AI request timed out. Try a smaller batch or disable thinking.');throw error;}
}
