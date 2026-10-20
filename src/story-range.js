const canonical=id=>String(id??'').replace(/_B$/,'');
export const manualStoryRange=card=>card.rangeMode==='manual'&&Number.isFinite(card.sin)&&Number.isFinite(card.sout)&&card.sin>=0&&card.sout>card.sin;
export function storyRange(card,cues,time) {
  if(manualStoryRange(card))return {start:card.sin,end:card.sout};
  const wanted=new Set((card.cueRefs||[]).map(canonical)),matched=cues.filter(c=>wanted.has(canonical(c.id)));
  if(!matched.length)return {start:card.sin??0,end:card.sout??0};
  const times=matched.map(time);return {start:Math.min(...times.map(t=>t.start)),end:Math.max(...times.map(t=>t.end))};
}
export function saveStoryRange(card,{start,end,refs,relink},currentBody='') {
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('Enter a nonnegative In and a later Out.');
  const patch={sin:start,sout:end,rangeMode:'manual'};
  if(!relink)return patch;
  if(refs.length)return {...patch,kind:card.kind==='clip'?'clip':'cue',cueRefs:refs.map(canonical),sourceCueRefs:refs.map(canonical),body:'',bodyManual:false};
  // A range in a speech gap must not erase the existing authored text.
  return {...patch,cueRefs:[],sourceCueRefs:card.sourceCueRefs?.length?card.sourceCueRefs:card.cueRefs||[],body:currentBody||card.body||'',bodyManual:true};
}
export function storyGroupRange(card,group,index,count,cues,time) {
  const derived=storyRange({cueRefs:group},cues,time);
  if(!manualStoryRange(card))return derived;
  if(count===1)return {start:card.sin,end:card.sout};
  return {start:index===0?card.sin:Math.max(card.sin,derived.start),end:index===count-1?card.sout:Math.min(card.sout,derived.end)};
}
export function parseStoryTimecode(text,offset=0,fps=25) {
  const match=String(text).trim().match(/^(\d+):(\d+):(\d+)[:;.](\d+)$/);
  if(!match)return null;
  const [h,m,s,f]=match.slice(1).map(Number);
  if(m>=60||s>=60||f>=fps)return null;
  const seconds=h*3600+m*60+s+f/fps-offset;
  return Number.isFinite(seconds)?seconds:null;
}
