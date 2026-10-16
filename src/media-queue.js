// One extraction at a time also establishes the upload owner cookie before
// another /api/media/start request, and avoids the server's 12-job ceiling.
export function serialScheduler() {
  let tail=Promise.resolve();
  return work=>{const current=tail.then(work);tail=current.catch(()=>{});return current;};
}
export function cacheAudio(map,key,samples,{limit=512*1024*1024,protectedKeys=new Set(),recoverable=()=>true}={}) {
  map.delete(key);map.set(key,samples);
  let bytes=[...map.values()].reduce((n,s)=>n+s.byteLength,0);
  for(const [old,value]of map){
    if(bytes<=limit)break;
    if(old===key||protectedKeys.has(old)||!recoverable(old))continue;
    map.delete(old);bytes-=value.byteLength;
  }
}
export async function transcribeQueue(keys,run,signal,onChange=()=>{}) {
  const items=keys.map(key=>({key,state:'pending'}));
  const publish=()=>onChange(items.map(item=>({...item})));
  publish();
  for(const item of items){
    if(signal.aborted)break;
    item.state='running';publish();
    try {const result=await run(item.key);Object.assign(item,result||{state:'failed',error:'Transcription did not return a result.'});}
    catch(error){item.state=signal.aborted?'cancelled':'failed';item.error=error.message;}
    if(signal.aborted&&item.state!=='completed')item.state='cancelled';
    publish();
  }
  if(signal.aborted)for(const item of items)if(item.state==='pending')item.state='cancelled';
  publish();return items;
}
